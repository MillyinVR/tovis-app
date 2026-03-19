// app/api/pro/bookings/route.ts
import { Prisma, ServiceLocationType } from '@prisma/client'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { moneyToString } from '@/lib/money'
import { pickBool, pickInt } from '@/lib/pick'
import { computeRequestedEndUtc } from '@/lib/booking/slotReadiness'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { createProBooking } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

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

function toDateOrNull(value: unknown): Date | null {
  const raw = pickString(value)
  if (!raw) return null

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function decimalToCents(value: Prisma.Decimal): number {
  const asMoneyString = value.toString()
  const cleaned = asMoneyString.replace(/\$/g, '').replace(/,/g, '').trim()
  const match = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!match) return 0

  const whole = match[1] || '0'
  let frac = (match[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'

  return Math.max(0, Number(whole) * 100 + Number(frac || '0'))
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const clientId = pickString(body.clientId)
    const clientAddressId = pickString(body.clientAddressId)
    const scheduledFor = toDateOrNull(body.scheduledFor)
    const internalNotes = pickString(body.internalNotes)

    const locationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const offeringId = pickString(body.offeringId)

    const requestedBufferMinutes = pickInt(body.bufferMinutes)
    const requestedTotalDurationMinutes = pickInt(body.totalDurationMinutes)

    const allowOutsideWorkingHours =
      pickBool(body.allowOutsideWorkingHours) ?? false
    const allowShortNotice = pickBool(body.allowShortNotice) ?? false
    const allowFarFuture = pickBool(body.allowFarFuture) ?? false

    if (!clientId) {
      return bookingJsonFail('CLIENT_ID_REQUIRED')
    }

    if (!scheduledFor) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    if (!locationId) {
      return bookingJsonFail('LOCATION_ID_REQUIRED')
    }

    if (!locationType) {
      return bookingJsonFail('LOCATION_TYPE_REQUIRED')
    }

    if (!offeringId) {
      return bookingJsonFail('OFFERING_ID_REQUIRED')
    }

    if (locationType === ServiceLocationType.MOBILE && !clientAddressId) {
      return bookingJsonFail('CLIENT_SERVICE_ADDRESS_REQUIRED', {
        userMessage: 'Mobile bookings require a saved client service address.',
      })
    }

    const result = await createProBooking({
      professionalId,
      clientId,
      offeringId,
      locationId,
      locationType,
      scheduledFor,
      clientAddressId,
      internalNotes,
      requestedBufferMinutes,
      requestedTotalDurationMinutes,
      allowOutsideWorkingHours,
      allowShortNotice,
      allowFarFuture,
    })

    const endsAt = computeRequestedEndUtc({
      startUtc: new Date(result.booking.scheduledFor),
      durationMinutes: Number(result.booking.totalDurationMinutes),
      bufferMinutes: Number(result.booking.bufferMinutes),
    })

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          scheduledFor: new Date(result.booking.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(result.booking.totalDurationMinutes),
          bufferMinutes: Number(result.booking.bufferMinutes),
          status: result.booking.status,
          serviceName: result.serviceName,
          subtotalSnapshot:
            moneyToString(result.subtotalSnapshot) ??
            result.subtotalSnapshot.toString(),
          subtotalCents: decimalToCents(result.subtotalSnapshot),
          locationId: result.locationId,
          locationType: result.locationType,
          clientAddressId: result.clientAddressId,
          stepMinutes: result.stepMinutes,
          timeZone: result.appointmentTimeZone,
        },
      },
      201,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings error', error)
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error ? error.message : 'Failed to create booking.',
      userMessage: 'Failed to create booking.',
    })
  }
}