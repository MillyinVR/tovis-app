// app/api/client/bookings/[id]/checkout/products/route.ts
import type { NextRequest } from 'next/server'
import { Prisma, Role } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { upsertClientBookingCheckoutProducts } from '@/lib/booking/writeBoundary'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'

type SelectedCheckoutProductInput = {
  recommendationId: string
  productId: string
  quantity: number
}

type ParsedItemsResult =
  | { ok: true; value: SelectedCheckoutProductInput[] }
  | { ok: false; error: string }

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

const MAX_ITEMS = 25
const MAX_ID_LENGTH = 191
const MAX_QUANTITY = 99

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN

  if (!Number.isFinite(parsed)) return null

  const whole = Math.trunc(parsed)
  if (whole <= 0 || whole > MAX_QUANTITY) return null

  return whole
}

function parseItems(input: unknown): ParsedItemsResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'items must be an array.' }
  }

  if (input.length > MAX_ITEMS) {
    return { ok: false, error: `items max is ${MAX_ITEMS}.` }
  }

  const out: SelectedCheckoutProductInput[] = []
  const seenRecommendationIds = new Set<string>()

  for (const row of input) {
    if (!isObject(row)) {
      return {
        ok: false,
        error: 'Each selected product must be an object.',
      }
    }

    const recommendationId =
      typeof row.recommendationId === 'string'
        ? row.recommendationId.trim().slice(0, MAX_ID_LENGTH)
        : ''

    const productId =
      typeof row.productId === 'string'
        ? row.productId.trim().slice(0, MAX_ID_LENGTH)
        : ''

    const quantity = normalizePositiveInt(row.quantity)

    if (!recommendationId) {
      return {
        ok: false,
        error: 'Each selected product needs a recommendationId.',
      }
    }

    if (!productId) {
      return {
        ok: false,
        error: 'Each selected product needs a productId.',
      }
    }

    if (quantity == null) {
      return {
        ok: false,
        error: `Each selected product needs a quantity between 1 and ${MAX_QUANTITY}.`,
      }
    }

    if (seenRecommendationIds.has(recommendationId)) {
      return {
        ok: false,
        error: 'Duplicate recommendationId values are not allowed.',
      }
    }

    seenRecommendationIds.add(recommendationId)
    out.push({
      recommendationId,
      productId,
      quantity,
    })
  }

  return { ok: true, value: out }
}

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}

function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

function idempotencyInProgressFail(): Response {
  return jsonFail(
    409,
    'A matching checkout products request is already in progress.',
    {
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    },
  )
}

function idempotencyConflictFail(): Response {
  return jsonFail(
    409,
    'This idempotency key was already used with a different request body.',
    {
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    },
  )
}

function readHeaderValue(req: Request, name: string): string | null {
  return pickString(req.headers.get(name))
}

function readRequestMeta(
  req: Request,
  body: Record<string, unknown>,
): RequestMeta {
  return {
    requestId:
      readHeaderValue(req, 'x-request-id') ??
      readHeaderValue(req, 'request-id') ??
      null,
    idempotencyKey:
      readHeaderValue(req, 'idempotency-key') ??
      readHeaderValue(req, 'x-idempotency-key') ??
      pickString(body.idempotencyKey) ??
      null,
  }
}

function normalizeItemsForIdempotency(
  items: SelectedCheckoutProductInput[],
): SelectedCheckoutProductInput[] {
  return [...items].sort((a, b) =>
    `${a.recommendationId}:${a.productId}`.localeCompare(
      `${b.recommendationId}:${b.productId}`,
    ),
  )
}

function normalizeNestedJsonValue(value: unknown): NestedInputJsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJsonValue(item))
  }

  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(input).sort()) {
      out[key] = normalizeNestedJsonValue(input[key])
    }

    return out
  }

  return String(value)
}

function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (value === null || value === undefined) {
    return {}
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      value: normalizeNestedJsonValue(value),
    }
  }

  const input = value as Record<string, unknown>
  const out: JsonObjectPayload = {}

  for (const key of Object.keys(input).sort()) {
    out[key] = normalizeNestedJsonValue(input[key])
  }

  return out
}

function buildCheckoutProductsResponseBody(args: {
  result: Awaited<ReturnType<typeof upsertClientBookingCheckoutProducts>>
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    booking: {
      id: args.result.booking.id,
      checkoutStatus: args.result.booking.checkoutStatus,
      serviceSubtotalSnapshot:
        args.result.booking.serviceSubtotalSnapshot?.toString() ?? null,
      productSubtotalSnapshot:
        args.result.booking.productSubtotalSnapshot?.toString() ?? null,
      subtotalSnapshot: args.result.booking.subtotalSnapshot?.toString() ?? null,
      tipAmount: args.result.booking.tipAmount?.toString() ?? null,
      taxAmount: args.result.booking.taxAmount?.toString() ?? null,
      discountAmount: args.result.booking.discountAmount?.toString() ?? null,
      totalAmount: args.result.booking.totalAmount?.toString() ?? null,
      paymentAuthorizedAt:
        args.result.booking.paymentAuthorizedAt?.toISOString() ?? null,
      paymentCollectedAt:
        args.result.booking.paymentCollectedAt?.toISOString() ?? null,
    },
    selectedProducts: args.result.selectedProducts.map((item) => ({
      recommendationId: item.recommendationId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      lineTotal: item.lineTotal.toString(),
    })),
    meta: args.result.meta,
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failIdempotency({ idempotencyRecordId }).catch((failError) => {
    console.error(
      'POST /api/client/bookings/[id]/checkout/products idempotency failure update error:',
      failError,
    )
  })
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const actorUserId = pickString(auth.user?.id)

    if (!actorUserId) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to update this checkout.',
      })
    }

    const { id } = await props.params
    const bookingId = trimmedString(id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body: Record<string, unknown> = isObject(rawBody) ? rawBody : {}

    const parsedItems = parseItems(body.items)
    if (!parsedItems.ok) {
      return jsonFail(400, parsedItems.error)
    }

    const { requestId, idempotencyKey } = readRequestMeta(req, body)

    const idempotencyItems = normalizeItemsForIdempotency(parsedItems.value)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId,
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_CHECKOUT_PRODUCTS,
      key: idempotencyKey,
      requestBody: {
        actorUserId,
        clientId: auth.clientId,
        bookingId,
        items: idempotencyItems,
      },
    })

    if (idempotency.kind === 'missing_key') {
      return idempotencyMissingKeyFail()
    }

    if (idempotency.kind === 'in_progress') {
      return idempotencyInProgressFail()
    }

    if (idempotency.kind === 'conflict') {
      return idempotencyConflictFail()
    }

    if (idempotency.kind === 'replay') {
      return jsonOk(idempotency.responseBody, idempotency.responseStatus)
    }

    const startedIdempotencyRecordId = idempotency.idempotencyRecordId
    idempotencyRecordId = startedIdempotencyRecordId

    const result = await upsertClientBookingCheckoutProducts({
      bookingId,
      clientId: auth.clientId,
      items: parsedItems.value,
      requestId,
      idempotencyKey,
    })

    const responseBody = buildCheckoutProductsResponseBody({ result })

    await completeIdempotency({
      idempotencyRecordId: startedIdempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failStartedIdempotency(idempotencyRecordId)
    }

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error(
      'POST /api/client/bookings/[id]/checkout/products error',
      error,
    )
    captureBookingException({
      error,
      route: 'POST /api/client/bookings/[id]/checkout/products',
    })

    return jsonFail(500, 'Internal server error.')
  }
}