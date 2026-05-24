// app/api/bookings/[id]/reschedule/route.ts
import { Role, type Prisma } from '@prisma/client'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { rescheduleBookingFromHold } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { isRecord } from '@/lib/guards'
import { DEFAULT_TIME_ZONE } from '@/lib/timeZone'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError, safeLogMeta } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RescheduleResponseBody = Prisma.InputJsonObject

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

function buildRescheduleIdempotencyBody(args: {
  bookingId: string
  clientId: string
  holdId: string
  requestedLocationType: string | null
}): Prisma.InputJsonObject {
  return {
    bookingId: args.bookingId,
    clientId: args.clientId,
    holdId: args.holdId,
    requestedLocationType: args.requestedLocationType,
  }
}

function toRescheduleResponseBody(
  result: Awaited<ReturnType<typeof rescheduleBookingFromHold>>,
): RescheduleResponseBody {
  return {
    ok: true,
    booking: {
      id: result.booking.id,
      status: result.booking.status,
      scheduledFor: result.booking.scheduledFor.toISOString(),
      locationType: result.booking.locationType,
      bufferMinutes: result.booking.bufferMinutes,
      totalDurationMinutes: result.booking.totalDurationMinutes,
      locationTimeZone: result.booking.locationTimeZone,
    },
    meta: result.meta,
  }
}

export async function POST(req: Request, { params }: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId

    const resolvedParams = await Promise.resolve(params)
    const bookingId = pickString(resolvedParams.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const holdId = pickString(body.holdId)

    if (!holdId) {
      return bookingJsonFail('HOLD_ID_REQUIRED')
    }

    const hasLocationType = Object.prototype.hasOwnProperty.call(
      body,
      'locationType',
    )

    const requestedLocationType = hasLocationType
      ? normalizeLocationType(body.locationType)
      : null

    if (hasLocationType && requestedLocationType == null) {
      return bookingJsonFail('INVALID_LOCATION_TYPE')
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'bookings:reschedule',
      key: clientRateLimitKey({
        clientId,
        userId: auth.user.id,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const idempotency = await beginRouteIdempotency<RescheduleResponseBody>({
      request: req,
      actor: {
        actorKey: `client:${clientId}`,
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_RESCHEDULE,
      requestLabel: 'booking reschedule',
      requestBody: buildRescheduleIdempotencyBody({
        bookingId,
        clientId,
        holdId,
        requestedLocationType,
      }),
      messages: {
        missingKey: 'Missing idempotency key for booking reschedule.',
        inProgress:
          'A matching booking reschedule request is already in progress.',
        conflict:
          'This idempotency key was already used with different reschedule details.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const result = await rescheduleBookingFromHold({
      bookingId,
      clientId,
      holdId,
      requestedLocationType,
      fallbackTimeZone: DEFAULT_TIME_ZONE,
    })

    const responseBody = toRescheduleResponseBody(result)

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: 'POST /api/bookings/[id]/reschedule',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/bookings/[id]/reschedule error', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'POST /api/bookings/[id]/reschedule',
        idempotencyRecordId,
      }),
    })

    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error ? error.message : 'Failed to reschedule booking.',
      userMessage: 'Failed to reschedule booking.',
    })
  }
}