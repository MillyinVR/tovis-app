// app/api/pro/bookings/[id]/start/route.ts

import { Prisma, Role } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { startBookingSession } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RequestMeta = {
  requestId: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

type StartSessionResponseBody = JsonObjectPayload

function bookingBase(bookingId: string): string {
  return `/pro/bookings/${encodeURIComponent(bookingId)}`
}

function sessionHubHref(bookingId: string): string {
  return `${bookingBase(bookingId)}/session`
}

function readRequestMeta(request: Request): RequestMeta {
  return {
    requestId:
      pickString(request.headers.get('x-request-id')) ??
      pickString(request.headers.get('request-id')) ??
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function buildStartSessionIdempotencyBody(args: {
  professionalId: string
  actorUserId: string
  bookingId: string
  explicitSelection: boolean
}): JsonObjectPayload {
  return {
    professionalId: args.professionalId,
    actorUserId: args.actorUserId,
    bookingId: args.bookingId,
    explicitSelection: args.explicitSelection,
  }
}

function buildStartSessionResponseBody(
  result: Awaited<ReturnType<typeof startBookingSession>>,
): StartSessionResponseBody {
  return normalizeJsonObjectPayload({
    booking: result.booking,
    nextHref: sessionHubHref(result.booking.id),
    meta: result.meta,
  })
}

export async function POST(request: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null
  const { requestId } = readRequestMeta(request)

  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to start this booking.',
      })
    }

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}
    const explicitSelection = body.explicitSelection === true

    const idempotency = await beginRouteIdempotency<StartSessionResponseBody>({
      request,
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_START_SESSION,
      requestLabel: 'booking start',
      requestBody: buildStartSessionIdempotencyBody({
        professionalId,
        actorUserId,
        bookingId,
        explicitSelection,
      }),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress:
          'A matching booking start request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await startBookingSession({
      bookingId,
      professionalId,
      requestId,
      idempotencyKey: idempotency.idempotencyKey,
      explicitSelection,
      actorUserId,
    })

    const responseBody = buildStartSessionResponseBody(result)

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: 'POST /api/pro/bookings/[id]/start',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/start error', {
      requestId,
      error: safeError(error),
    })

    return jsonFail(500, 'Internal server error')
  }
}