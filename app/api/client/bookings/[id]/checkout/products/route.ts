// app/api/client/bookings/[id]/checkout/products/route.ts

import type { NextRequest } from 'next/server'
import { Prisma, Role } from '@prisma/client'

import { jsonFail, requireClient } from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { upsertClientBookingCheckoutProducts } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'

const ROUTE_OPERATION = 'POST /api/client/bookings/[id]/checkout/products'

type SelectedCheckoutProductInput = {
  recommendationId: string
  productId: string
  quantity: number
}

type ParsedItemsResult =
  | { ok: true; value: SelectedCheckoutProductInput[] }
  | { ok: false; error: string }

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

function readRequestId(req: Request): string | null {
  return (
    trimmedString(req.headers.get('x-request-id')) ??
    trimmedString(req.headers.get('request-id')) ??
    null
  )
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

  if (isObject(value)) {
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeNestedJsonValue(value[key])
    }

    return out
  }

  return String(value)
}

function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (value === null || value === undefined) {
    return {}
  }

  if (!isObject(value)) {
    return {
      value: normalizeNestedJsonValue(value),
    }
  }

  const out: JsonObjectPayload = {}

  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeNestedJsonValue(value[key])
  }

  return out
}

function buildIdempotencyRequestBody(args: {
  actorUserId: string
  clientId: string
  bookingId: string
  items: SelectedCheckoutProductInput[]
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    actorUserId: args.actorUserId,
    clientId: args.clientId,
    bookingId: args.bookingId,
    items: normalizeItemsForIdempotency(args.items),
  })
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

export async function POST(req: NextRequest, props: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const actorUserId = trimmedString(auth.user?.id)

    if (!actorUserId) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to update this checkout.',
      })
    }

    const { id } = await resolveRouteParams(props)
    const bookingId = trimmedString(id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isObject(rawBody) ? rawBody : {}

    const parsedItems = parseItems(body.items)
    if (!parsedItems.ok) {
      return jsonFail(400, parsedItems.error)
    }

    const requestId = readRequestId(req)

    return await withRouteIdempotency<JsonObjectPayload>(
      {
        request: req,
        actor: {
          actorUserId,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.CLIENT_CHECKOUT_PRODUCTS,
        requestLabel: 'client checkout products',
        requestBody: buildIdempotencyRequestBody({
          actorUserId,
          clientId: auth.clientId,
          bookingId,
          items: parsedItems.value,
        }),
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress:
            'A matching checkout products request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: ROUTE_OPERATION,
      },
      async (idem) => {
        const result = await upsertClientBookingCheckoutProducts({
          bookingId,
          clientId: auth.clientId,
          items: parsedItems.value,
          requestId,
          idempotencyKey: idem.idempotencyKey,
        })

        const responseBody = buildCheckoutProductsResponseBody({ result })

        return { status: 200, body: responseBody }
      },
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error(`${ROUTE_OPERATION} error`, error)

    captureBookingException({
      error,
      route: ROUTE_OPERATION,
    })

    return jsonFail(500, 'Internal server error.')
  }
}