// app/api/bookings/[id]/reschedule/route.ts
import { ServiceLocationType } from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { DEFAULT_TIME_ZONE } from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { rescheduleBookingFromHold } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

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

export async function POST(req: Request, { params }: Ctx) {
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

    const result = await rescheduleBookingFromHold({
      bookingId,
      clientId,
      holdId,
      requestedLocationType,
      fallbackTimeZone: DEFAULT_TIME_ZONE,
    })

    return jsonOk(
      {
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
      },
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/bookings/[id]/reschedule error', error)
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error ? error.message : 'Failed to reschedule booking.',
      userMessage: 'Failed to reschedule booking.',
    })
  }
}