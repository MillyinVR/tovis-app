// app/api/bookings/[id]/reschedule/route.ts

import {
  BookingStatus,
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import {
  DEFAULT_TIME_ZONE,
  minutesSinceMidnightInTimeZone,
} from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import { assertTimeRangeAvailable } from '@/lib/booking/conflictQueries'
import {
  normalizeLocationType,
  resolveValidatedBookingContext,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalToNumber,
  pickFormattedAddressFromSnapshot,
} from '@/lib/booking/snapshots'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'
import { withLockedClientOwnedBookingTransaction } from '@/lib/booking/scheduleTransaction'
import {
  bookingError,
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

type WorkingHoursGuardCode =
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'OUTSIDE_WORKING_HOURS'

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

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toInputJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? null : toInputJsonValue(item)))
  }

  if (value === null || typeof value !== 'object') {
    return {}
  }

  const out: Record<string, Prisma.InputJsonValue | null> = {}

  for (const key of Object.keys(value)) {
    const child = value[key]
    if (child === undefined) continue
    out[key] = child === null ? null : toInputJsonValue(child)
  }

  return out
}

function toNullableJsonCreateInput(
  value: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return toInputJsonValue(value)
}

function mapSchedulingReadinessErrorToBookingCode(
  error: SchedulingReadinessError,
): BookingErrorCode {
  switch (error) {
    case 'LOCATION_NOT_FOUND':
      return 'LOCATION_NOT_FOUND'
    case 'TIMEZONE_REQUIRED':
      return 'TIMEZONE_REQUIRED'
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'MODE_NOT_SUPPORTED':
      return 'MODE_NOT_SUPPORTED'
    case 'DURATION_REQUIRED':
      return 'DURATION_REQUIRED'
    case 'PRICE_REQUIRED':
      return 'PRICE_REQUIRED'
    case 'COORDINATES_REQUIRED':
      return 'COORDINATES_REQUIRED'
  }
}

function makeWorkingHoursGuardMessage(code: WorkingHoursGuardCode): string {
  return `${WORKING_HOURS_ERROR_PREFIX}${code}`
}

function parseWorkingHoursGuardMessage(
  value: string,
): WorkingHoursGuardCode | null {
  if (!value.startsWith(WORKING_HOURS_ERROR_PREFIX)) return null

  const code = value.slice(WORKING_HOURS_ERROR_PREFIX.length)

  switch (code) {
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'OUTSIDE_WORKING_HOURS':
      return 'OUTSIDE_WORKING_HOURS'
    default:
      return null
  }
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

    const result = await withLockedClientOwnedBookingTransaction({
      bookingId,
      clientId,
      run: async ({ tx, now }) => {
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

        if (!booking) {
          throw bookingError('BOOKING_NOT_FOUND')
        }

        if (
          booking.status === BookingStatus.COMPLETED ||
          booking.status === BookingStatus.CANCELLED
        ) {
          throw bookingError('BOOKING_NOT_RESCHEDULABLE')
        }

        if (booking.startedAt || booking.finishedAt) {
          throw bookingError('BOOKING_ALREADY_STARTED')
        }

        if (!booking.offeringId) {
          throw bookingError('BOOKING_MISSING_OFFERING')
        }

        const bookingOffering = await tx.professionalServiceOffering.findUnique({
          where: { id: booking.offeringId },
          select: {
            id: true,
            offersInSalon: true,
            offersMobile: true,
            salonPriceStartingAt: true,
            salonDurationMinutes: true,
            mobilePriceStartingAt: true,
            mobileDurationMinutes: true,
          },
        })

        if (!bookingOffering) {
          throw bookingError('OFFERING_NOT_FOUND')
        }

        const rawDuration = Number(booking.totalDurationMinutes ?? 0)
        if (
          !Number.isFinite(rawDuration) ||
          rawDuration < 15 ||
          rawDuration > MAX_SLOT_DURATION_MINUTES
        ) {
          throw bookingError('INVALID_DURATION')
        }

        const totalDurationMinutes = clampInt(
          Math.trunc(rawDuration),
          15,
          MAX_SLOT_DURATION_MINUTES,
        )

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
            clientAddressId: true,
            clientAddressSnapshot: true,
            clientAddressLatSnapshot: true,
            clientAddressLngSnapshot: true,
          },
        })

        if (!hold) {
          throw bookingError('HOLD_NOT_FOUND')
        }

        if (hold.clientId !== clientId) {
          throw bookingError('HOLD_FORBIDDEN')
        }

        if (hold.expiresAt.getTime() <= now.getTime()) {
          throw bookingError('HOLD_EXPIRED')
        }

        if (hold.professionalId !== booking.professionalId) {
          throw bookingError('HOLD_MISMATCH', {
            message: 'Hold is for a different professional.',
            userMessage:
              'That hold no longer matches this booking. Please pick a new slot.',
          })
        }

        if (hold.offeringId !== booking.offeringId) {
          throw bookingError('HOLD_MISMATCH', {
            message: 'Hold is for a different service.',
            userMessage:
              'That hold no longer matches this booking. Please pick a new slot.',
          })
        }

        if (
          requestedLocationType &&
          hold.locationType !== requestedLocationType
        ) {
          throw bookingError('HOLD_MISMATCH', {
            message: 'Hold location type does not match the requested location type.',
            userMessage:
              'That hold no longer matches this booking. Please pick a new slot.',
          })
        }

        if (!hold.locationId) {
          throw bookingError('HOLD_MISMATCH', {
            message: 'Hold is missing location info.',
            userMessage:
              'That hold is missing location info. Please pick a new slot.',
          })
        }

        if (hold.locationType === ServiceLocationType.MOBILE) {
          const clientServiceAddressFromHold = pickFormattedAddressFromSnapshot(
            hold.clientAddressSnapshot,
          )

          if (!hold.clientAddressId || !clientServiceAddressFromHold) {
            throw bookingError('HOLD_MISSING_CLIENT_ADDRESS')
          }

          const ownedClientAddress = await tx.clientAddress.findFirst({
            where: {
              id: hold.clientAddressId,
              clientId,
              kind: ClientAddressKind.SERVICE_ADDRESS,
            },
            select: { id: true },
          })

          if (!ownedClientAddress) {
            throw bookingError('CLIENT_SERVICE_ADDRESS_REQUIRED')
          }
        }

        const validatedContextResult = await resolveValidatedBookingContext({
          tx,
          professionalId: booking.professionalId,
          requestedLocationId: hold.locationId,
          locationType: hold.locationType,
          holdLocationTimeZone: hold.locationTimeZone,
          fallbackTimeZone: DEFAULT_TIME_ZONE,
          requireValidTimeZone: true,
          allowFallback: false,
          requireCoordinates: false,
          offering: {
            offersInSalon: bookingOffering.offersInSalon,
            offersMobile: bookingOffering.offersMobile,
            salonDurationMinutes: bookingOffering.salonDurationMinutes,
            mobileDurationMinutes: bookingOffering.mobileDurationMinutes,
            salonPriceStartingAt: bookingOffering.salonPriceStartingAt,
            mobilePriceStartingAt: bookingOffering.mobilePriceStartingAt,
          },
        })

        if (!validatedContextResult.ok) {
          throw bookingError(
            mapSchedulingReadinessErrorToBookingCode(
              validatedContextResult.error,
            ),
          )
        }

        const locationContext = validatedContextResult.context

        const salonAddressText =
          hold.locationType === ServiceLocationType.SALON
            ? pickFormattedAddressFromSnapshot(hold.locationAddressSnapshot) ??
              normalizeAddress(locationContext.formattedAddress)
            : null

        if (
          hold.locationType === ServiceLocationType.SALON &&
          !salonAddressText
        ) {
          throw bookingError('SALON_LOCATION_ADDRESS_REQUIRED')
        }

        const newStart = normalizeToMinute(new Date(hold.scheduledFor))
        if (!Number.isFinite(newStart.getTime())) {
          throw bookingError('HOLD_TIME_INVALID')
        }

        if (newStart.getTime() < now.getTime()) {
          throw bookingError('TIME_IN_PAST')
        }

        if (
          newStart.getTime() <
          now.getTime() + locationContext.advanceNoticeMinutes * 60_000
        ) {
          throw bookingError('ADVANCE_NOTICE_REQUIRED')
        }

        if (
          newStart.getTime() >
          now.getTime() + locationContext.maxDaysAhead * 24 * 60 * 60_000
        ) {
          throw bookingError('MAX_DAYS_AHEAD_EXCEEDED')
        }

        const startMinuteOfDay = minutesSinceMidnightInTimeZone(
          newStart,
          locationContext.timeZone,
        )

        if (startMinuteOfDay % locationContext.stepMinutes !== 0) {
          throw bookingError('STEP_MISMATCH', {
            message: `Start time must be on a ${locationContext.stepMinutes}-minute boundary.`,
            userMessage: `Start time must be on a ${locationContext.stepMinutes}-minute boundary.`,
          })
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
            missing: makeWorkingHoursGuardMessage('WORKING_HOURS_REQUIRED'),
            outside: makeWorkingHoursGuardMessage('OUTSIDE_WORKING_HOURS'),
            misconfigured: makeWorkingHoursGuardMessage('WORKING_HOURS_INVALID'),
          },
        })

        if (!workingHoursCheck.ok) {
          const workingHoursCode = parseWorkingHoursGuardMessage(
            workingHoursCheck.error,
          )

          if (workingHoursCode === 'WORKING_HOURS_REQUIRED') {
            throw bookingError('WORKING_HOURS_REQUIRED')
          }

          if (workingHoursCode === 'WORKING_HOURS_INVALID') {
            throw bookingError('WORKING_HOURS_INVALID')
          }

          if (workingHoursCode === 'OUTSIDE_WORKING_HOURS') {
            throw bookingError('OUTSIDE_WORKING_HOURS')
          }

          throw bookingError('OUTSIDE_WORKING_HOURS', {
            message: workingHoursCheck.error,
            userMessage:
              workingHoursCheck.error || 'That time is outside working hours.',
          })
        }

        try {
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
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : ''

          if (message === 'TIME_BLOCKED') {
            throw bookingError('TIME_BLOCKED')
          }

          if (message === 'TIME_BOOKED') {
            throw bookingError('TIME_BOOKED')
          }

          if (message === 'TIME_HELD') {
            throw bookingError('TIME_HELD')
          }

          throw error
        }

        const salonLocationAddressSnapshotInput:
          | Prisma.InputJsonValue
          | Prisma.NullableJsonNullValueInput =
          hold.locationType === ServiceLocationType.SALON && salonAddressText
            ? buildAddressSnapshot(salonAddressText) ?? Prisma.JsonNull
            : Prisma.JsonNull

        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            scheduledFor: newStart,
            locationType: hold.locationType,
            bufferMinutes: locationContext.bufferMinutes,
            locationId: locationContext.locationId,
            locationTimeZone: locationContext.timeZone,

            locationAddressSnapshot: salonLocationAddressSnapshotInput,
            locationLatSnapshot:
              decimalToNumber(hold.locationLatSnapshot) ?? locationContext.lat,
            locationLngSnapshot:
              decimalToNumber(hold.locationLngSnapshot) ?? locationContext.lng,

            clientAddressId:
              hold.locationType === ServiceLocationType.MOBILE
                ? hold.clientAddressId
                : null,
            clientAddressSnapshot:
              hold.locationType === ServiceLocationType.MOBILE
                ? toNullableJsonCreateInput(hold.clientAddressSnapshot)
                : Prisma.JsonNull,
            clientAddressLatSnapshot:
              hold.locationType === ServiceLocationType.MOBILE
                ? decimalToNumber(hold.clientAddressLatSnapshot)
                : null,
            clientAddressLngSnapshot:
              hold.locationType === ServiceLocationType.MOBILE
                ? decimalToNumber(hold.clientAddressLngSnapshot)
                : null,
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
      },
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
    if (isBookingError(e)) {
      return bookingJsonFail(e.code, {
        message: e.message,
        userMessage: e.userMessage,
      })
    }

    console.error('POST /api/bookings/[id]/reschedule error', e)
    return bookingJsonFail('INTERNAL_ERROR', {
      message: e instanceof Error ? e.message : 'Failed to reschedule booking.',
      userMessage: 'Failed to reschedule booking.',
    })
  }
}