// app/api/pro/bookings/[id]/final-review/route.ts
import {
  jsonFail,
  jsonOk,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { confirmBookingFinalReview } from '@/lib/booking/writeBoundary'
import {
  AftercareRebookMode,
  BookingServiceItemType,
  Prisma,
  Role,
} from '@prisma/client'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'

type Ctx = {
  params: { id: string } | Promise<{ id: string }>
}

type FinalReviewLineItemInput = {
  bookingServiceItemId?: unknown
  serviceId?: unknown
  offeringId?: unknown
  itemType?: unknown
  price?: unknown
  durationMinutes?: unknown
  notes?: unknown
  sortOrder?: unknown
}

type FinalReviewRecommendedProductInput = {
  name?: unknown
  url?: unknown
  note?: unknown
}

type FinalReviewRequestBody = {
  finalLineItems?: unknown
  expectedSubtotal?: unknown
  recommendedProducts?: unknown
  rebookMode?: unknown
  rebookedFor?: unknown
  rebookWindowStart?: unknown
  rebookWindowEnd?: unknown
}

type NormalizedFinalLineItem = {
  bookingServiceItemId?: string | null
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  price: string | number
  durationMinutes: number
  notes?: string | null
  sortOrder: number
}

type NormalizedRecommendedProduct = {
  productId: null
  externalName: string
  externalUrl: string
  note: string | null
}

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
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
    'A matching final review request is already in progress.',
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

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNullableTrimmedString(value: unknown): string | null {
  const trimmed = asTrimmedString(value)
  return trimmed.length > 0 ? trimmed : null
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function asNullableDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseItemType(value: unknown): BookingServiceItemType | null {
  const raw = asTrimmedString(value).toUpperCase()

  if (raw === BookingServiceItemType.BASE) {
    return BookingServiceItemType.BASE
  }

  if (raw === BookingServiceItemType.ADD_ON) {
    return BookingServiceItemType.ADD_ON
  }

  return null
}

function parsePriceInput(value: unknown): string | number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? trimmed : null
  }

  return null
}

function parseRebookMode(value: unknown): AftercareRebookMode | null {
  const raw = asTrimmedString(value).toUpperCase()
  if (!raw) return null

  if (raw === AftercareRebookMode.NONE) {
    return AftercareRebookMode.NONE
  }

  if (raw === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
    return AftercareRebookMode.BOOKED_NEXT_APPOINTMENT
  }

  if (raw === AftercareRebookMode.RECOMMENDED_WINDOW) {
    return AftercareRebookMode.RECOMMENDED_WINDOW
  }

  return null
}

function normalizeFinalLineItems(
  value: unknown,
): NormalizedFinalLineItem[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  const normalized: NormalizedFinalLineItem[] = []

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    if (!isRecord(raw)) return null

    const row = raw as FinalReviewLineItemInput

    const serviceId = asTrimmedString(row.serviceId)
    if (!serviceId) return null

    const itemType = parseItemType(row.itemType)
    if (!itemType) return null

    const price = parsePriceInput(row.price)
    if (price == null) return null

    const durationMinutes = asFiniteNumber(row.durationMinutes)
    if (durationMinutes == null) return null

    const sortOrderRaw = asFiniteNumber(row.sortOrder)
    const sortOrder =
      sortOrderRaw == null ? index : Math.max(0, Math.trunc(sortOrderRaw))

    normalized.push({
      bookingServiceItemId: asNullableTrimmedString(row.bookingServiceItemId),
      serviceId,
      offeringId: asNullableTrimmedString(row.offeringId),
      itemType,
      price,
      durationMinutes: Math.trunc(durationMinutes),
      notes: asNullableTrimmedString(row.notes),
      sortOrder,
    })
  }

  return normalized
}

function normalizeRecommendedProducts(
  value: unknown,
): NormalizedRecommendedProduct[] {
  if (!Array.isArray(value)) return []

  const normalized: NormalizedRecommendedProduct[] = []

  for (const raw of value) {
    if (!isRecord(raw)) continue

    const row = raw as FinalReviewRecommendedProductInput
    const externalName = asTrimmedString(row.name)
    const externalUrl = asTrimmedString(row.url)
    const note = asNullableTrimmedString(row.note)

    if (!externalName || !externalUrl) continue

    normalized.push({
      productId: null,
      externalName,
      externalUrl,
      note,
    })
  }

  return normalized
}

function readHeaderValue(req: Request, name: string): string | null {
  return pickString(req.headers.get(name))
}

function readRequestMeta(req: Request): RequestMeta {
  return {
    requestId:
      readHeaderValue(req, 'x-request-id') ??
      readHeaderValue(req, 'request-id') ??
      null,
    idempotencyKey:
      readHeaderValue(req, 'idempotency-key') ??
      readHeaderValue(req, 'x-idempotency-key') ??
      null,
  }
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

function buildFinalReviewResponseBody(args: {
  result: Awaited<ReturnType<typeof confirmBookingFinalReview>>
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    booking: {
      id: args.result.booking.id,
      status: args.result.booking.status,
      sessionStep: args.result.booking.sessionStep,
      serviceId: args.result.booking.serviceId,
      offeringId: args.result.booking.offeringId,
      subtotalSnapshot:
        args.result.booking.subtotalSnapshot == null
          ? null
          : String(args.result.booking.subtotalSnapshot),
      totalDurationMinutes: args.result.booking.totalDurationMinutes,
    },
    meta: args.result.meta,
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failIdempotency({ idempotencyRecordId }).catch((failError) => {
    console.error(
      'POST /api/pro/bookings/[id]/final-review idempotency failure update error:',
      failError,
    )
  })
}

export async function POST(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = pickString(auth.user?.id)

    if (!actorUserId) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to confirm this final review.',
      })
    }

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => null)
    if (!isRecord(rawBody)) {
      return jsonFail(400, 'Invalid request body.')
    }

    const body = rawBody as FinalReviewRequestBody

    const finalLineItems = normalizeFinalLineItems(body.finalLineItems)
    if (!finalLineItems) {
      return jsonFail(
        400,
        'Invalid finalLineItems. Each item needs serviceId, itemType, price, and durationMinutes.',
      )
    }

    const expectedSubtotal =
      typeof body.expectedSubtotal === 'string' ||
      typeof body.expectedSubtotal === 'number' ||
      body.expectedSubtotal == null
        ? body.expectedSubtotal
        : null

    const recommendedProducts = normalizeRecommendedProducts(
      body.recommendedProducts,
    )

    const rebookMode = parseRebookMode(body.rebookMode)
    if (body.rebookMode != null && rebookMode == null) {
      return jsonFail(400, 'Invalid rebookMode.')
    }

    const rebookedFor = asNullableDate(body.rebookedFor)
    if (body.rebookedFor != null && body.rebookedFor !== '' && !rebookedFor) {
      return jsonFail(400, 'Invalid rebookedFor date.')
    }

    const rebookWindowStart = asNullableDate(body.rebookWindowStart)
    if (
      body.rebookWindowStart != null &&
      body.rebookWindowStart !== '' &&
      !rebookWindowStart
    ) {
      return jsonFail(400, 'Invalid rebookWindowStart date.')
    }

    const rebookWindowEnd = asNullableDate(body.rebookWindowEnd)
    if (
      body.rebookWindowEnd != null &&
      body.rebookWindowEnd !== '' &&
      !rebookWindowEnd
    ) {
      return jsonFail(400, 'Invalid rebookWindowEnd date.')
    }

    const { requestId, idempotencyKey } = readRequestMeta(req)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_FINAL_REVIEW,
      key: idempotencyKey,
      requestBody: {
        actorUserId,
        professionalId,
        bookingId,
        finalLineItems,
        expectedSubtotal,
        recommendedProducts,
        rebookMode,
        rebookedFor,
        rebookWindowStart,
        rebookWindowEnd,
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

    const result = await confirmBookingFinalReview({
      bookingId,
      professionalId,
      finalLineItems,
      expectedSubtotal,
      recommendedProducts,
      rebookMode,
      rebookedFor,
      rebookWindowStart,
      rebookWindowEnd,
      requestId,
      idempotencyKey,
    })

    const responseBody = buildFinalReviewResponseBody({ result })

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

    console.error('POST /api/pro/bookings/[id]/final-review error', error)
    captureBookingException({
      error,
      route: 'POST /api/pro/bookings/[id]/final-review',
    })

    return jsonFail(500, 'Internal server error')
  }
}