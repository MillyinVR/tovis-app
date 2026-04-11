// app/api/pro/bookings/route.ts
import { Prisma, ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { computeRequestedEndUtc } from '@/lib/booking/slotReadiness'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { createProBookingWithClient } from '@/lib/booking/createProBookingWithClient'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { isRecord } from '@/lib/guards'
import { moneyToString } from '@/lib/money'
import { pickBool, pickInt } from '@/lib/pick'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

function pickClientPayload(body: Record<string, unknown>) {
  if (isRecord(body.client)) {
    return body.client
  }

  return {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to create this booking.',
      })
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const clientId = pickString(body.clientId)
    const client = pickClientPayload(body)

    const clientAddressId = pickString(body.clientAddressId)
    const scheduledFor = toDateOrNull(body.scheduledFor)
    const internalNotes = pickString(body.internalNotes)
    const overrideReason = pickString(body.overrideReason)

    const locationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const offeringId = pickString(body.offeringId)

    const requestedBufferMinutes = pickInt(body.bufferMinutes)
    const requestedTotalDurationMinutes = pickInt(body.totalDurationMinutes)

    const allowOutsideWorkingHours =
      pickBool(body.allowOutsideWorkingHours) ?? false
    const allowShortNotice = pickBool(body.allowShortNotice) ?? false
    const allowFarFuture = pickBool(body.allowFarFuture) ?? false

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

    const result = await createProBookingWithClient({
      professionalId,
      actorUserId,
      overrideReason,
      clientId,
      client,
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

    if (!result.ok) {
      return jsonFail(result.status, result.error, { code: result.code })
    }

    const bookingResult = result.bookingResult

    const endsAt = computeRequestedEndUtc({
      startUtc: new Date(bookingResult.booking.scheduledFor),
      durationMinutes: Number(bookingResult.booking.totalDurationMinutes),
      bufferMinutes: Number(bookingResult.booking.bufferMinutes),
    })

    return jsonOk(
      {
        booking: {
          id: bookingResult.booking.id,
          clientId: result.clientId,
          scheduledFor: new Date(bookingResult.booking.scheduledFor).toISOString(),
          endsAt: endsAt.toISOString(),
          totalDurationMinutes: Number(bookingResult.booking.totalDurationMinutes),
          bufferMinutes: Number(bookingResult.booking.bufferMinutes),
          status: bookingResult.booking.status,
          serviceName: bookingResult.serviceName,
          subtotalSnapshot:
            moneyToString(bookingResult.subtotalSnapshot) ??
            bookingResult.subtotalSnapshot.toString(),
          subtotalCents: decimalToCents(bookingResult.subtotalSnapshot),
          locationId: bookingResult.locationId,
          locationType: bookingResult.locationType,
          clientAddressId: bookingResult.clientAddressId,
          stepMinutes: bookingResult.stepMinutes,
          timeZone: bookingResult.appointmentTimeZone,
        },
        client: {
          id: result.clientId,
          userId: result.clientUserId,
          email: result.clientEmail,
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