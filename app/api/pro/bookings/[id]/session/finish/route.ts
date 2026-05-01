// app/api/pro/bookings/[id]/session/finish/route.ts
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { Prisma, Role, SessionStep } from '@prisma/client'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { finishBookingSession } from '@/lib/booking/writeBoundary'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

function bookingBase(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/session`
}

function afterPhotosHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/session/after-photos`
}

function aftercareHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/aftercare`
}

function nextHrefFromState(args: {
  bookingId: string
  sessionStep: SessionStep
  afterCount: number
}): string {
  if (args.sessionStep === SessionStep.DONE) {
    return aftercareHref(args.bookingId)
  }

  if (args.sessionStep === SessionStep.AFTER_PHOTOS) {
    return args.afterCount > 0
      ? aftercareHref(args.bookingId)
      : afterPhotosHref(args.bookingId)
  }

  return sessionHubHref(args.bookingId)
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
    'A matching booking finish request is already in progress.',
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

function readRequestMeta(request: Request): RequestMeta {
  const requestId =
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null

  const idempotencyKey =
    pickString(request.headers.get('idempotency-key')) ??
    pickString(request.headers.get('x-idempotency-key')) ??
    null

  return { requestId, idempotencyKey }
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

/**
 * Finish session.
 *
 * Important:
 * - Does not complete the booking. Aftercare send does that later.
 * - Requires startedAt inside writeBoundary.
 * - Canonical behavior: move session into FINISH_REVIEW.
 * - Idempotent: if already in FINISH_REVIEW / AFTER_PHOTOS / DONE,
 *   returns a stable nextHref.
 */
export async function POST(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to finish this booking session.',
      })
    }

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const { requestId, idempotencyKey } = readRequestMeta(req)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_FINISH_SESSION,
      key: idempotencyKey,
      requestBody: {
        professionalId,
        actorUserId,
        bookingId,
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

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await finishBookingSession({
      bookingId,
      professionalId,
      requestId,
      idempotencyKey,
    })

    const responseBody = normalizeJsonObjectPayload({
      booking: result.booking,
      nextHref: nextHrefFromState({
        bookingId: result.booking.id,
        sessionStep: result.booking.sessionStep,
        afterCount: result.afterCount,
      }),
      afterCount: result.afterCount,
      meta: result.meta,
    })

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failIdempotency({ idempotencyRecordId }).catch((failError) => {
        console.error(
          'POST /api/pro/bookings/[id]/session/finish idempotency failure update error:',
          failError,
        )
      })
    }

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/session/finish error', error)

    return jsonFail(500, 'Internal server error')
  }
}