// app/api/pro/bookings/[id]/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickBool,
  pickInt,
  pickIsoDate,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import {
  BookingServiceItemType,
  BookingStatus,
} from '@prisma/client'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'
import { resolveAppointmentSchedulingContext } from '@/lib/booking/timeZoneTruth'
import { moneyToFixed2String } from '@/lib/money'
import { isRecord } from '@/lib/guards'
import { DEFAULT_DURATION_MINUTES } from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import { type RequestedServiceItemInput, sumDecimal } from '@/lib/booking/serviceItems'
import {
  decimalToNullableNumber,
  pickFormattedAddressFromSnapshot,
} from '@/lib/booking/snapshots'
import {
  bookingError,
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { updateProBooking } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RequestedStatus =
  | typeof BookingStatus.ACCEPTED
  | typeof BookingStatus.CANCELLED

function normalizeRequestedStatus(value: unknown): RequestedStatus | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (normalized === BookingStatus.ACCEPTED) return BookingStatus.ACCEPTED
  if (normalized === BookingStatus.CANCELLED) return BookingStatus.CANCELLED

  return null
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

function parseRequestedServiceItems(
  raw: unknown,
): RequestedServiceItemInput[] | null {
  if (raw === undefined) return null
  if (!Array.isArray(raw)) throw bookingError('INVALID_SERVICE_ITEMS')
  if (raw.length === 0) throw bookingError('INVALID_SERVICE_ITEMS')

  const parsed = raw.map((entry, index) => {
    if (!isRecord(entry)) throw bookingError('INVALID_SERVICE_ITEMS')

    const serviceId = pickString(entry.serviceId)
    const offeringId = pickString(entry.offeringId)
    const sortOrder = pickInt(entry.sortOrder)

    if (!serviceId || !offeringId) {
      throw bookingError('INVALID_SERVICE_ITEMS')
    }

    return {
      serviceId,
      offeringId,
      sortOrder: sortOrder != null ? sortOrder : index,
    }
  })

  return [...parsed].sort((a, b) => a.sortOrder - b.sortOrder)
}

function normalizeOutputTimeZone(value: string): string {
  return isValidIanaTimeZone(value) ? sanitizeTimeZone(value, 'UTC') : 'UTC'
}

async function resolveBookingSchedulingContext(args: {
  bookingLocationTimeZone?: unknown
  locationId?: string | null
  professionalId: string
  professionalTimeZone?: unknown
  fallback?: string
  requireValid?: boolean
}) {
  const result = await resolveAppointmentSchedulingContext({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    locationId: args.locationId ?? null,
    professionalId: args.professionalId,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback ?? 'UTC',
    requireValid: args.requireValid,
  })

  if (!result.ok) {
    throw bookingError('TIMEZONE_REQUIRED')
  }

  return {
    ...result.context,
    appointmentTimeZone: normalizeOutputTimeZone(
      result.context.appointmentTimeZone,
    ),
  }
}

/* ---------------------------------------------
   GET
--------------------------------------------- */

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, professionalId },
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        locationType: true,
        bufferMinutes: true,
        totalDurationMinutes: true,
        subtotalSnapshot: true,
        clientId: true,
        locationId: true,
        locationTimeZone: true,
        locationAddressSnapshot: true,
        locationLatSnapshot: true,
        locationLngSnapshot: true,
        serviceItems: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            serviceId: true,
            offeringId: true,
            priceSnapshot: true,
            durationMinutesSnapshot: true,
            sortOrder: true,
            itemType: true,
            service: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        client: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            user: { select: { email: true } },
          },
        },
        professional: {
          select: { timeZone: true },
        },
      },
    })

    if (!booking) {
      return bookingJsonFail('BOOKING_NOT_FOUND')
    }

    const start = normalizeToMinute(new Date(booking.scheduledFor))
    if (!Number.isFinite(start.getTime())) {
      return bookingJsonFail('INTERNAL_ERROR', {
        message: 'Booking has an invalid scheduled time.',
        userMessage: 'Failed to load booking.',
      })
    }

    const items = booking.serviceItems ?? []
    const computedDuration = items.reduce(
      (sum, item) => sum + Number(item.durationMinutesSnapshot ?? 0),
      0,
    )
    const computedSubtotal = sumDecimal(items.map((item) => item.priceSnapshot))

    const totalDurationMinutes =
      Number(booking.totalDurationMinutes ?? 0) > 0
        ? Number(booking.totalDurationMinutes)
        : computedDuration > 0
          ? computedDuration
          : DEFAULT_DURATION_MINUTES

    const bufferMinutes = Math.max(0, Number(booking.bufferMinutes ?? 0))

    const firstName = booking.client?.firstName?.trim() || ''
    const lastName = booking.client?.lastName?.trim() || ''
    const fullName =
      firstName || lastName
        ? `${firstName} ${lastName}`.trim()
        : booking.client?.user?.email || 'Client'

    const schedulingContext = await resolveBookingSchedulingContext({
      bookingLocationTimeZone: booking.locationTimeZone,
      locationId: booking.locationId ?? null,
      professionalId,
      professionalTimeZone: booking.professional?.timeZone,
      fallback: 'UTC',
      requireValid: false,
    })

    return jsonOk(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          scheduledFor: start.toISOString(),
          endsAt: addMinutes(
            start,
            totalDurationMinutes + bufferMinutes,
          ).toISOString(),
          locationId: booking.locationId ?? null,
          locationType: booking.locationType,
          locationAddressSnapshot: pickFormattedAddressFromSnapshot(
            booking.locationAddressSnapshot,
          ),
          locationLatSnapshot: decimalToNullableNumber(
            booking.locationLatSnapshot,
          ),
          locationLngSnapshot: decimalToNullableNumber(
            booking.locationLngSnapshot,
          ),
          bufferMinutes,
          durationMinutes: totalDurationMinutes,
          totalDurationMinutes,
          subtotalSnapshot: moneyToFixed2String(
            booking.subtotalSnapshot ?? computedSubtotal,
          ),
          client: {
            fullName,
            email: booking.client?.user?.email ?? null,
            phone: booking.client?.phone ?? null,
          },
          timeZone: schedulingContext.appointmentTimeZone,
          timeZoneSource: schedulingContext.timeZoneSource,
          serviceItems: items.map((item) => ({
            id: item.id,
            serviceId: item.serviceId,
            offeringId: item.offeringId ?? null,
            itemType: item.itemType ?? BookingServiceItemType.ADD_ON,
            serviceName: item.service?.name ?? 'Service',
            priceSnapshot: moneyToFixed2String(item.priceSnapshot),
            durationMinutesSnapshot: Number(item.durationMinutesSnapshot ?? 0),
            sortOrder: item.sortOrder,
          })),
        },
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

    console.error('GET /api/pro/bookings/[id] error:', error)
    return bookingJsonFail('INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Failed to load booking.',
      userMessage: 'Failed to load booking.',
    })
  }
}

/* ---------------------------------------------
   PATCH
--------------------------------------------- */

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const rec = isRecord(rawBody) ? rawBody : {}

    const hasStatus = Object.prototype.hasOwnProperty.call(rec, 'status')
    const hasNotifyClient = Object.prototype.hasOwnProperty.call(
      rec,
      'notifyClient',
    )
    const hasAllowOutside = Object.prototype.hasOwnProperty.call(
      rec,
      'allowOutsideWorkingHours',
    )
    const hasAllowShortNotice = Object.prototype.hasOwnProperty.call(
      rec,
      'allowShortNotice',
    )
    const hasAllowFarFuture = Object.prototype.hasOwnProperty.call(
      rec,
      'allowFarFuture',
    )
    const hasScheduledFor = Object.prototype.hasOwnProperty.call(
      rec,
      'scheduledFor',
    )
    const hasBuffer = Object.prototype.hasOwnProperty.call(rec, 'bufferMinutes')
    const hasDuration =
      Object.prototype.hasOwnProperty.call(rec, 'durationMinutes') ||
      Object.prototype.hasOwnProperty.call(rec, 'totalDurationMinutes')
    const hasServiceItems = Object.prototype.hasOwnProperty.call(
      rec,
      'serviceItems',
    )

    const nextStatus = normalizeRequestedStatus(rec.status)
    if (hasStatus && nextStatus == null) {
      return bookingJsonFail('INVALID_STATUS', {
        userMessage: 'Invalid status. Use ACCEPTED or CANCELLED.',
      })
    }

    const notifyClient = pickBool(rec.notifyClient)
    if (hasNotifyClient && notifyClient == null) {
      return bookingJsonFail('INVALID_BOOLEAN', {
        message: 'notifyClient must be boolean.',
        userMessage: 'notifyClient must be boolean.',
      })
    }

    const allowOutsideWorkingHours = pickBool(rec.allowOutsideWorkingHours)
    if (hasAllowOutside && allowOutsideWorkingHours == null) {
      return bookingJsonFail('INVALID_BOOLEAN', {
        message: 'allowOutsideWorkingHours must be boolean.',
        userMessage: 'allowOutsideWorkingHours must be boolean.',
      })
    }

    const allowShortNotice = pickBool(rec.allowShortNotice)
    if (hasAllowShortNotice && allowShortNotice == null) {
      return bookingJsonFail('INVALID_BOOLEAN', {
        message: 'allowShortNotice must be boolean.',
        userMessage: 'allowShortNotice must be boolean.',
      })
    }

    const allowFarFuture = pickBool(rec.allowFarFuture)
    if (hasAllowFarFuture && allowFarFuture == null) {
      return bookingJsonFail('INVALID_BOOLEAN', {
        message: 'allowFarFuture must be boolean.',
        userMessage: 'allowFarFuture must be boolean.',
      })
    }

    const nextStart = pickIsoDate(rec.scheduledFor)
    if (hasScheduledFor && !nextStart) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    const nextBuffer =
      rec.bufferMinutes != null ? pickInt(rec.bufferMinutes) : null
    if (hasBuffer && nextBuffer == null) {
      return bookingJsonFail('INVALID_BUFFER_MINUTES')
    }

    const rawDurationValue = rec.durationMinutes ?? rec.totalDurationMinutes
    const nextDuration =
      rawDurationValue != null ? pickInt(rawDurationValue) : null
    if (hasDuration && nextDuration == null) {
      return bookingJsonFail('INVALID_DURATION_MINUTES')
    }

    let parsedRequestedItems: RequestedServiceItemInput[] | null
    try {
      parsedRequestedItems = parseRequestedServiceItems(rec.serviceItems)
    } catch (error: unknown) {
      if (isBookingError(error)) {
        return bookingJsonFail(error.code, {
          message: error.message,
          userMessage: error.userMessage,
        })
      }
      throw error
    }

    const result = await updateProBooking({
      professionalId,
      bookingId,
      nextStatus,
      notifyClient: notifyClient === true,
      allowOutsideWorkingHours: allowOutsideWorkingHours === true,
      allowShortNotice: allowShortNotice === true,
      allowFarFuture: allowFarFuture === true,
      nextStart,
      nextBuffer,
      nextDuration,
      parsedRequestedItems,
      hasBuffer,
      hasDuration,
      hasServiceItems,
    })

    return jsonOk(result, 200)
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('PATCH /api/pro/bookings/[id] error:', error)
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error ? error.message : 'Failed to update booking.',
      userMessage: 'Failed to update booking.',
    })
  }
}