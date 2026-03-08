// app/api/bookings/[id]/reschedule/route.ts
//3726 leave alone
import { prisma } from '@/lib/prisma'
import { BookingStatus, ServiceLocationType } from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { DEFAULT_TIME_ZONE, minutesSinceMidnightInTimeZone } from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import {
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import { assertTimeRangeAvailable } from '@/lib/booking/conflictQueries'
import {
  normalizeLocationType,
  resolveBookingLocationContext,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalToNumber,
  pickFormattedAddressFromSnapshot,
} from '@/lib/booking/snapshots'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type RescheduleErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'FORBIDDEN'
  | 'BOOKING_NOT_RESCHEDULABLE'
  | 'BOOKING_ALREADY_STARTED'
  | 'BOOKING_MISSING_OFFERING'
  | 'OFFERING_NOT_FOUND'
  | 'MODE_NOT_SUPPORTED'
  | 'HOLD_NOT_FOUND'
  | 'HOLD_FORBIDDEN'
  | 'HOLD_EXPIRED'
  | 'HOLD_PRO_MISMATCH'
  | 'HOLD_OFFERING_MISMATCH'
  | 'HOLD_LOCATIONTYPE_MISMATCH'
  | 'HOLD_MISSING_LOCATION'
  | 'LOCATION_NOT_FOUND'
  | 'TIMEZONE_REQUIRED'
  | 'HOLD_TIME_INVALID'
  | 'TIME_IN_PAST'
  | 'TOO_FAR'
  | 'BLOCKED'
  | 'TIME_NOT_AVAILABLE'
  | 'INVALID_DURATION'

function throwCode(code: RescheduleErrorCode): never {
  throw new Error(code)
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId

    const resolvedParams = await Promise.resolve(params)
    const bookingId = pickString(resolvedParams.id)
    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const holdId = pickString(body.holdId)
    if (!holdId) {
      return jsonFail(400, 'Missing holdId.')
    }

    const hasLocationType = Object.prototype.hasOwnProperty.call(body, 'locationType')
    const requestedLocationType = hasLocationType
      ? normalizeLocationType(body.locationType)
      : null

    if (hasLocationType && requestedLocationType == null) {
      return jsonFail(400, 'Missing or invalid locationType.')
    }

    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          status: true,
          clientId: true,
          professionalId: true,
          offeringId: true,
          startedAt: true,
          finishedAt: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
      })

      if (!booking) throwCode('BOOKING_NOT_FOUND')
      if (booking.clientId !== clientId) throwCode('FORBIDDEN')

      if (
        booking.status === BookingStatus.COMPLETED ||
        booking.status === BookingStatus.CANCELLED
      ) {
        throwCode('BOOKING_NOT_RESCHEDULABLE')
      }

      if (booking.startedAt || booking.finishedAt) {
        throwCode('BOOKING_ALREADY_STARTED')
      }

      if (!booking.offeringId) {
        throwCode('BOOKING_MISSING_OFFERING')
      }

      const bookingOffering = await tx.professionalServiceOffering.findUnique({
        where: { id: booking.offeringId },
        select: {
          id: true,
          offersInSalon: true,
          offersMobile: true,
        },
      })

      if (!bookingOffering) {
        throwCode('OFFERING_NOT_FOUND')
      }

      const rawDuration = Number(booking.totalDurationMinutes ?? 0)
      if (
        !Number.isFinite(rawDuration) ||
        rawDuration < 15 ||
        rawDuration > MAX_SLOT_DURATION_MINUTES
      ) {
        throwCode('INVALID_DURATION')
      }

      const totalDurationMinutes = Math.trunc(rawDuration)

      const hold = await tx.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          offeringId: true,
          scheduledFor: true,
          expiresAt: true,
          locationType: true,
          locationId: true,
          locationTimeZone: true,
          locationAddressSnapshot: true,
          locationLatSnapshot: true,
          locationLngSnapshot: true,
        },
      })

      if (!hold) throwCode('HOLD_NOT_FOUND')
      if (hold.clientId !== clientId) throwCode('HOLD_FORBIDDEN')
      if (hold.expiresAt.getTime() <= now.getTime()) throwCode('HOLD_EXPIRED')
      if (hold.professionalId !== booking.professionalId) throwCode('HOLD_PRO_MISMATCH')
      if (hold.offeringId !== booking.offeringId) throwCode('HOLD_OFFERING_MISMATCH')

      if (requestedLocationType && hold.locationType !== requestedLocationType) {
        throwCode('HOLD_LOCATIONTYPE_MISMATCH')
      }

      if (hold.locationType === ServiceLocationType.SALON && !bookingOffering.offersInSalon) {
        throwCode('MODE_NOT_SUPPORTED')
      }

      if (hold.locationType === ServiceLocationType.MOBILE && !bookingOffering.offersMobile) {
        throwCode('MODE_NOT_SUPPORTED')
      }

      if (!hold.locationId) throwCode('HOLD_MISSING_LOCATION')

      const locationContextResult = await resolveBookingLocationContext({
        tx,
        professionalId: booking.professionalId,
        requestedLocationId: hold.locationId,
        locationType: hold.locationType,
        holdLocationTimeZone: hold.locationTimeZone,
        fallbackTimeZone: DEFAULT_TIME_ZONE,
        requireValidTimeZone: true,
        allowFallback: false,
      })

      if (!locationContextResult.ok) {
        throwCode(locationContextResult.error)
      }

      const locationContext = locationContextResult.context

      const newStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (!Number.isFinite(newStart.getTime())) {
        throwCode('HOLD_TIME_INVALID')
      }

      if (
        newStart.getTime() <
        now.getTime() + locationContext.advanceNoticeMinutes * 60_000
      ) {
        throwCode('TIME_IN_PAST')
      }

      if (
        newStart.getTime() >
        now.getTime() + locationContext.maxDaysAhead * 24 * 60 * 60_000
      ) {
        throwCode('TOO_FAR')
      }

      const startMinuteOfDay = minutesSinceMidnightInTimeZone(
        newStart,
        locationContext.timeZone,
      )

      if (startMinuteOfDay % locationContext.stepMinutes !== 0) {
        throw new Error(`STEP:${locationContext.stepMinutes}`)
      }

      const newEnd = addMinutes(
        newStart,
        totalDurationMinutes + locationContext.bufferMinutes,
      )

      const workingHoursCheck = ensureWithinWorkingHours({
        scheduledStartUtc: newStart,
        scheduledEndUtc: newEnd,
        workingHours: locationContext.workingHours,
        timeZone: locationContext.timeZone,
        fallbackTimeZone: DEFAULT_TIME_ZONE,
        messages: {
          missing: 'This professional has not set working hours yet.',
          outside: 'That time is outside this professional’s working hours.',
          misconfigured: 'This professional’s working hours are misconfigured.',
        },
      })

      if (!workingHoursCheck.ok) {
        throw new Error(`WH:${workingHoursCheck.error}`)
      }

      await assertTimeRangeAvailable({
        tx,
        professionalId: booking.professionalId,
        locationId: locationContext.locationId,
        requestedStart: newStart,
        requestedEnd: newEnd,
        defaultBufferMinutes: locationContext.bufferMinutes,
        fallbackDurationMinutes: totalDurationMinutes,
        excludeBookingId: booking.id,
        excludeHoldId: hold.id,
      })

      const formattedAddressFromHold = pickFormattedAddressFromSnapshot(
        hold.locationAddressSnapshot,
      )

      const locationAddressSnapshot = buildAddressSnapshot(
        formattedAddressFromHold ?? locationContext.formattedAddress,
      )

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          scheduledFor: newStart,
          locationType: hold.locationType,
          bufferMinutes: locationContext.bufferMinutes,
          locationId: locationContext.locationId,
          locationTimeZone: locationContext.timeZone,
          locationAddressSnapshot,
          locationLatSnapshot:
            decimalToNumber(hold.locationLatSnapshot) ?? locationContext.lat,
          locationLngSnapshot:
            decimalToNumber(hold.locationLngSnapshot) ?? locationContext.lng,
        },
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          locationType: true,
          bufferMinutes: true,
          totalDurationMinutes: true,
          locationTimeZone: true,
        },
      })

      await tx.bookingHold.delete({
        where: { id: hold.id },
      })

      return updated
    })

    return jsonOk(
      {
        booking: {
          id: result.id,
          status: result.status,
          scheduledFor: new Date(result.scheduledFor).toISOString(),
          locationType: result.locationType,
          bufferMinutes: result.bufferMinutes ?? 0,
          totalDurationMinutes: result.totalDurationMinutes ?? 0,
          locationTimeZone: result.locationTimeZone ?? null,
        },
      },
      200,
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''

    if (msg === 'BOOKING_NOT_FOUND') {
      return jsonFail(404, 'Booking not found.')
    }
    if (msg === 'FORBIDDEN') {
      return jsonFail(403, 'Forbidden.')
    }
    if (msg === 'BOOKING_NOT_RESCHEDULABLE') {
      return jsonFail(409, 'This booking cannot be rescheduled.')
    }
    if (msg === 'BOOKING_ALREADY_STARTED') {
      return jsonFail(409, 'This booking has started and cannot be rescheduled.')
    }
    if (msg === 'BOOKING_MISSING_OFFERING' || msg === 'OFFERING_NOT_FOUND') {
      return jsonFail(409, 'This booking is missing offering info and cannot be rescheduled.')
    }
    if (msg === 'MODE_NOT_SUPPORTED') {
      return jsonFail(409, 'This booking does not support that location type.')
    }
    if (msg === 'HOLD_NOT_FOUND') {
      return jsonFail(404, 'Hold not found. Please pick a new time.')
    }
    if (msg === 'HOLD_FORBIDDEN') {
      return jsonFail(403, 'Hold does not belong to you.')
    }
    if (msg === 'HOLD_EXPIRED') {
      return jsonFail(409, 'Hold expired. Please pick a new time.')
    }
    if (msg === 'HOLD_PRO_MISMATCH') {
      return jsonFail(409, 'Hold is for a different professional.')
    }
    if (msg === 'HOLD_OFFERING_MISMATCH') {
      return jsonFail(409, 'Hold is for a different service.')
    }
    if (msg === 'HOLD_LOCATIONTYPE_MISMATCH') {
      return jsonFail(409, 'Hold locationType does not match.')
    }
    if (msg === 'HOLD_MISSING_LOCATION') {
      return jsonFail(409, 'Hold is missing location info. Please pick a new slot.')
    }
    if (msg === 'LOCATION_NOT_FOUND') {
      return jsonFail(409, 'This location is no longer available.')
    }
    if (msg === 'TIMEZONE_REQUIRED') {
      return jsonFail(409, 'This location is missing a valid timezone.')
    }
    if (msg === 'HOLD_TIME_INVALID') {
      return jsonFail(400, 'Hold time is invalid. Please pick a new slot.')
    }
    if (msg === 'TIME_IN_PAST') {
      return jsonFail(400, 'Please select a future time.')
    }
    if (msg === 'TOO_FAR') {
      return jsonFail(400, 'That date is too far in the future.')
    }
    if (msg === 'BLOCKED') {
      return jsonFail(409, 'That time is blocked. Please choose a new slot.')
    }
    if (msg === 'TIME_NOT_AVAILABLE') {
      return jsonFail(409, 'That time is no longer available. Please choose a new slot.')
    }
    if (msg === 'INVALID_DURATION') {
      return jsonFail(409, 'This booking has an invalid duration and cannot be rescheduled.')
    }
    if (msg.startsWith('STEP:')) {
      return jsonFail(400, `Start time must be on a ${msg.slice(5)}-minute boundary.`)
    }
    if (msg.startsWith('WH:')) {
      return jsonFail(400, msg.slice(3) || 'That time is outside working hours.')
    }

    console.error('POST /api/bookings/[id]/reschedule error', e)
    return jsonFail(500, 'Failed to reschedule booking.')
  }
}