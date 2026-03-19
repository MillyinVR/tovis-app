// app/api/bookings/[id]/reschedule/route.ts

import {
  BookingStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { DEFAULT_TIME_ZONE } from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'
import { normalizeToMinute } from '@/lib/booking/conflicts'
import {
  normalizeLocationType,
  resolveValidatedBookingContext,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalToNumber,
} from '@/lib/booking/snapshots'
import { withLockedClientOwnedBookingTransaction } from '@/lib/booking/scheduleTransaction'
import {
  bookingError,
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import {
  resolveHeldSalonAddressText,
  validateHoldForClientMutation,
} from '@/lib/booking/policies/holdRules'
import { evaluateRescheduleDecision } from '@/lib/booking/policies/reschedulePolicy'

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
            professional: {
              select: {
                timeZone: true,
              },
            },
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

        const validatedHold = await validateHoldForClientMutation({
          tx,
          hold,
          clientId,
          now,
          expectedProfessionalId: booking.professionalId,
          expectedOfferingId: booking.offeringId,
          expectedLocationType: requestedLocationType,
        })

        if (!validatedHold.ok) {
          throw bookingError(validatedHold.code, {
            message: validatedHold.message,
            userMessage: validatedHold.userMessage,
          })
        }

        const validatedContextResult = await resolveValidatedBookingContext({
          tx,
          professionalId: booking.professionalId,
          requestedLocationId: validatedHold.value.locationId,
          locationType: validatedHold.value.locationType,
          holdLocationTimeZone: validatedHold.value.locationTimeZone,
          professionalTimeZone: bookingOffering.professional?.timeZone ?? null,
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

        const salonAddressResolution = resolveHeldSalonAddressText({
          holdLocationType: validatedHold.value.locationType,
          holdLocationAddressSnapshot: hold?.locationAddressSnapshot,
          fallbackFormattedAddress: locationContext.formattedAddress,
        })

        if (!salonAddressResolution.ok) {
          throw bookingError(salonAddressResolution.code, {
            message: salonAddressResolution.message,
            userMessage: salonAddressResolution.userMessage,
          })
        }

        const newStart = normalizeToMinute(new Date(hold!.scheduledFor))

        const decision = await evaluateRescheduleDecision({
          tx,
          now,
          professionalId: booking.professionalId,
          bookingId: booking.id,
          holdId: hold!.id,
          requestedStart: newStart,
          durationMinutes: totalDurationMinutes,
          bufferMinutes: locationContext.bufferMinutes,
          locationId: locationContext.locationId,
          workingHours: locationContext.workingHours,
          timeZone: locationContext.timeZone,
          stepMinutes: locationContext.stepMinutes,
          advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
          maxDaysAhead: locationContext.maxDaysAhead,
          fallbackTimeZone: DEFAULT_TIME_ZONE,
        })

        if (!decision.ok) {
          throw bookingError(decision.code, {
            message: decision.message,
            userMessage: decision.userMessage,
          })
        }

        const salonLocationAddressSnapshotInput:
          | Prisma.InputJsonValue
          | Prisma.NullableJsonNullValueInput =
          validatedHold.value.locationType === ServiceLocationType.SALON &&
          salonAddressResolution.value
            ? buildAddressSnapshot(salonAddressResolution.value) ?? Prisma.JsonNull
            : Prisma.JsonNull

        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            scheduledFor: newStart,
            locationType: validatedHold.value.locationType,
            bufferMinutes: locationContext.bufferMinutes,
            locationId: locationContext.locationId,
            locationTimeZone: locationContext.timeZone,

            locationAddressSnapshot: salonLocationAddressSnapshotInput,
            locationLatSnapshot:
              decimalToNumber(hold?.locationLatSnapshot) ?? locationContext.lat,
            locationLngSnapshot:
              decimalToNumber(hold?.locationLngSnapshot) ?? locationContext.lng,

            clientAddressId:
              validatedHold.value.locationType === ServiceLocationType.MOBILE
                ? validatedHold.value.holdClientAddressId
                : null,
            clientAddressSnapshot:
              validatedHold.value.locationType === ServiceLocationType.MOBILE
                ? toNullableJsonCreateInput(hold?.clientAddressSnapshot)
                : Prisma.JsonNull,
            clientAddressLatSnapshot:
              validatedHold.value.locationType === ServiceLocationType.MOBILE
                ? decimalToNumber(hold?.clientAddressLatSnapshot)
                : null,
            clientAddressLngSnapshot:
              validatedHold.value.locationType === ServiceLocationType.MOBILE
                ? decimalToNumber(hold?.clientAddressLngSnapshot)
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
          where: { id: hold!.id },
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