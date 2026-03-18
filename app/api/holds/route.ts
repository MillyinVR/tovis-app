// app/api/holds/route.ts
import { NextRequest } from 'next/server'
import {
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { HOLD_MINUTES } from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import { logBookingConflict } from '@/lib/booking/conflictLogging'
import {
  normalizeLocationType,
  resolveValidatedBookingContext,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalToNumber,
} from '@/lib/booking/snapshots'
import {
  checkSlotReadiness,
  type SlotReadinessCode,
} from '@/lib/booking/slotReadiness'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'
import {
  getBookingFailPayload,
  type BookingErrorCode,
} from '@/lib/booking/errors'

export const dynamic = 'force-dynamic'

type HoldCreateFailure = {
  ok: false
  code: BookingErrorCode
  message?: string
  userMessage?: string
}

type HoldCreateSuccess = {
  ok: true
  status: 201
  hold: {
    id: string
    expiresAt: Date
    scheduledFor: Date
    locationType: ServiceLocationType
    locationId: string
    locationTimeZone: string | null
    clientAddressId: string | null
    clientAddressSnapshot: Prisma.JsonValue | null
  }
}

type HoldCreateResult = HoldCreateFailure | HoldCreateSuccess

function isValidDate(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime())
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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

function holdFailure(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
): HoldCreateFailure {
  return {
    ok: false,
    code,
    message: overrides?.message,
    userMessage: overrides?.userMessage,
  }
}

function mapSchedulingReadinessFailure(
  error: SchedulingReadinessError,
): HoldCreateFailure {
  switch (error) {
    case 'LOCATION_NOT_FOUND':
      return holdFailure('LOCATION_NOT_FOUND')

    case 'TIMEZONE_REQUIRED':
      return holdFailure('TIMEZONE_REQUIRED')

    case 'WORKING_HOURS_REQUIRED':
      return holdFailure('WORKING_HOURS_REQUIRED')

    case 'WORKING_HOURS_INVALID':
      return holdFailure('WORKING_HOURS_INVALID')

    case 'MODE_NOT_SUPPORTED':
      return holdFailure('MODE_NOT_SUPPORTED')

    case 'DURATION_REQUIRED':
      return holdFailure('DURATION_REQUIRED')

    case 'PRICE_REQUIRED':
      return holdFailure('PRICE_REQUIRED')

    case 'COORDINATES_REQUIRED':
      return holdFailure('COORDINATES_REQUIRED')
  }
}

async function loadClientServiceAddress(args: {
  tx: Prisma.TransactionClient
  clientId: string
  clientAddressId: string
}) {
  return args.tx.clientAddress.findFirst({
    where: {
      id: args.clientAddressId,
      clientId: args.clientId,
      kind: ClientAddressKind.SERVICE_ADDRESS,
    },
    select: {
      id: true,
      formattedAddress: true,
      lat: true,
      lng: true,
    },
  })
}

function mapSlotReadinessFailure(
  code: SlotReadinessCode,
): HoldCreateFailure {
  switch (code) {
    case 'STEP_MISMATCH':
      return holdFailure('STEP_MISMATCH')

    case 'ADVANCE_NOTICE_REQUIRED':
      return holdFailure('ADVANCE_NOTICE_REQUIRED')

    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return holdFailure('MAX_DAYS_AHEAD_EXCEEDED')

    case 'WORKING_HOURS_REQUIRED':
      return holdFailure('WORKING_HOURS_REQUIRED')

    case 'WORKING_HOURS_INVALID':
      return holdFailure('WORKING_HOURS_INVALID')

    case 'OUTSIDE_WORKING_HOURS':
      return holdFailure('OUTSIDE_WORKING_HOURS')

    case 'INVALID_START':
      return holdFailure('INVALID_SCHEDULED_FOR')

    case 'INVALID_DURATION':
      return holdFailure('DURATION_REQUIRED')

    case 'INVALID_BUFFER':
      return holdFailure('INTERNAL_ERROR', {
        message: 'Invalid buffer minutes.',
        userMessage: 'That time is not available.',
      })

    case 'INVALID_RANGE':
      return holdFailure('INVALID_SCHEDULED_FOR')
  }
}

function logHoldConflict(args: {
  professionalId: string
  locationId: string | null
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  conflictType:
    | 'BLOCKED'
    | 'BOOKING'
    | 'HOLD'
    | 'WORKING_HOURS'
    | 'STEP_BOUNDARY'
    | 'TIME_NOT_AVAILABLE'
  offeringId: string
  clientId: string
  clientAddressId?: string | null
  note?: string
  meta?: Record<string, unknown>
}) {
  logBookingConflict({
    action: 'BOOKING_CREATE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflictType,
    note: args.note ?? null,
    meta: {
      route: 'app/api/holds/route.ts',
      offeringId: args.offeringId,
      clientId: args.clientId,
      clientAddressId: args.clientAddressId ?? null,
      ...args.meta,
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const offeringId = pickString(body.offeringId)
    const requestedLocationId = pickString(body.locationId)
    const clientAddressId = pickString(body.clientAddressId)
    const locationType = normalizeLocationType(body.locationType)
    const scheduledForRaw = pickString(body.scheduledFor)

    if (!offeringId) {
      return bookingJsonFail('OFFERING_ID_REQUIRED')
    }

    if (!scheduledForRaw) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR', {
        message: 'Scheduled time is required.',
        userMessage: 'Missing scheduled time.',
      })
    }

    if (!locationType) {
      return bookingJsonFail('LOCATION_TYPE_REQUIRED')
    }

    if (
      locationType === ServiceLocationType.MOBILE &&
      !clientAddressId
    ) {
      return bookingJsonFail('CLIENT_SERVICE_ADDRESS_REQUIRED')
    }

    const scheduledForParsed = new Date(scheduledForRaw)
    if (!isValidDate(scheduledForParsed)) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    const requestedStart = normalizeToMinute(scheduledForParsed)

    if (requestedStart.getTime() < Date.now() + 60_000) {
      return bookingJsonFail('TIME_IN_PAST')
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        professional: {
          select: {
            timeZone: true,
          },
        },
      },
    })

    if (!offering || !offering.isActive) {
      return bookingJsonFail('OFFERING_NOT_FOUND')
    }

    const result = await withLockedProfessionalTransaction(
      offering.professionalId,
      async ({ tx, now }): Promise<HoldCreateResult> => {
        const selectedClientAddress =
          locationType === ServiceLocationType.MOBILE && clientAddressId
            ? await loadClientServiceAddress({
                tx,
                clientId,
                clientAddressId,
              })
            : null

        const clientServiceAddress =
          locationType === ServiceLocationType.MOBILE
            ? normalizeAddress(selectedClientAddress?.formattedAddress)
            : null

        if (locationType === ServiceLocationType.MOBILE) {
          if (!selectedClientAddress) {
            return holdFailure('CLIENT_SERVICE_ADDRESS_REQUIRED')
          }

          if (!clientServiceAddress) {
            return holdFailure('CLIENT_SERVICE_ADDRESS_INVALID')
          }
        }

        const validatedContextResult = await resolveValidatedBookingContext({
          tx,
          professionalId: offering.professionalId,
          requestedLocationId,
          locationType,
          professionalTimeZone: offering.professional?.timeZone ?? null,
          fallbackTimeZone: 'UTC',
          requireValidTimeZone: true,
          allowFallback: !requestedLocationId,
          requireCoordinates: false,
          offering: {
            offersInSalon: offering.offersInSalon,
            offersMobile: offering.offersMobile,
            salonDurationMinutes: offering.salonDurationMinutes,
            mobileDurationMinutes: offering.mobileDurationMinutes,
            salonPriceStartingAt: offering.salonPriceStartingAt,
            mobilePriceStartingAt: offering.mobilePriceStartingAt,
          },
        })

        if (!validatedContextResult.ok) {
          return mapSchedulingReadinessFailure(validatedContextResult.error)
        }

        const locationContext = validatedContextResult.context
        const durationMinutes = validatedContextResult.durationMinutes

        const salonLocationAddress =
          locationType === ServiceLocationType.SALON
            ? normalizeAddress(locationContext.formattedAddress)
            : null

        if (
          locationType === ServiceLocationType.SALON &&
          !salonLocationAddress
        ) {
          return holdFailure('SALON_LOCATION_ADDRESS_REQUIRED')
        }

        const slotReadiness = checkSlotReadiness({
          startUtc: requestedStart,
          nowUtc: now,
          durationMinutes,
          bufferMinutes: locationContext.bufferMinutes,
          workingHours: locationContext.workingHours,
          timeZone: locationContext.timeZone,
          stepMinutes: locationContext.stepMinutes,
          advanceNoticeMinutes: locationContext.advanceNoticeMinutes,
          maxDaysAhead: locationContext.maxDaysAhead,
          fallbackTimeZone: 'UTC',
        })

        const requestedEnd = slotReadiness.ok
          ? slotReadiness.endUtc
          : addMinutes(
              requestedStart,
              durationMinutes + locationContext.bufferMinutes,
            )

        if (!slotReadiness.ok) {
          const conflictType =
            slotReadiness.code === 'STEP_MISMATCH'
              ? 'STEP_BOUNDARY'
              : slotReadiness.code === 'WORKING_HOURS_REQUIRED' ||
                  slotReadiness.code === 'WORKING_HOURS_INVALID' ||
                  slotReadiness.code === 'OUTSIDE_WORKING_HOURS'
                ? 'WORKING_HOURS'
                : 'TIME_NOT_AVAILABLE'

          logHoldConflict({
            professionalId: offering.professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd,
            conflictType,
            offeringId: offering.id,
            clientId,
            clientAddressId,
            meta: {
              slotReadinessCode: slotReadiness.code,
              ...((slotReadiness.meta as Record<string, unknown> | undefined) ??
                {}),
            },
          })

          if (slotReadiness.code === 'STEP_MISMATCH') {
            return holdFailure('STEP_MISMATCH', {
              message: `Start time must be on a ${locationContext.stepMinutes}-minute boundary.`,
              userMessage: `Start time must be on a ${locationContext.stepMinutes}-minute boundary.`,
            })
          }

          if (slotReadiness.code === 'OUTSIDE_WORKING_HOURS') {
            return holdFailure('OUTSIDE_WORKING_HOURS', {
              message:
                typeof slotReadiness.meta?.workingHoursError === 'string'
                  ? slotReadiness.meta.workingHoursError
                  : 'That time is outside working hours.',
              userMessage:
                typeof slotReadiness.meta?.workingHoursError === 'string'
                  ? slotReadiness.meta.workingHoursError
                  : 'That time is outside working hours.',
            })
          }

          return mapSlotReadinessFailure(slotReadiness.code)
        }

        const conflict = await getTimeRangeConflict({
          tx,
          professionalId: offering.professionalId,
          locationId: locationContext.locationId,
          requestedStart,
          requestedEnd,
          defaultBufferMinutes: locationContext.bufferMinutes,
          fallbackDurationMinutes: durationMinutes,
        })

        if (conflict === 'BLOCKED') {
          logHoldConflict({
            professionalId: offering.professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd,
            conflictType: 'BLOCKED',
            offeringId: offering.id,
            clientId,
            clientAddressId,
          })

          return holdFailure('TIME_BLOCKED')
        }

        if (conflict === 'BOOKING') {
          logHoldConflict({
            professionalId: offering.professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd,
            conflictType: 'BOOKING',
            offeringId: offering.id,
            clientId,
            clientAddressId,
          })

          return holdFailure('TIME_BOOKED')
        }

        if (conflict === 'HOLD') {
          logHoldConflict({
            professionalId: offering.professionalId,
            locationId: locationContext.locationId,
            locationType,
            requestedStart,
            requestedEnd,
            conflictType: 'HOLD',
            offeringId: offering.id,
            clientId,
            clientAddressId,
          })

          return holdFailure('TIME_HELD')
        }

        const expiresAt = addMinutes(now, HOLD_MINUTES)

        const locationAddressSnapshotInput:
          | Prisma.InputJsonValue
          | Prisma.NullableJsonNullValueInput =
          locationType === ServiceLocationType.SALON && salonLocationAddress
            ? buildAddressSnapshot(salonLocationAddress) ?? Prisma.JsonNull
            : Prisma.JsonNull

        const clientAddressSnapshotInput:
          | Prisma.InputJsonValue
          | Prisma.NullableJsonNullValueInput =
          locationType === ServiceLocationType.MOBILE && clientServiceAddress
            ? buildAddressSnapshot(clientServiceAddress) ?? Prisma.JsonNull
            : Prisma.JsonNull

        try {
          const hold = await tx.bookingHold.create({
            data: {
              offeringId: offering.id,
              professionalId: offering.professionalId,
              clientId,
              scheduledFor: requestedStart,
              expiresAt,
              locationType,
              locationId: locationContext.locationId,
              locationTimeZone: locationContext.timeZone,

              locationAddressSnapshot: locationAddressSnapshotInput,
              locationLatSnapshot: locationContext.lat,
              locationLngSnapshot: locationContext.lng,

              clientAddressId:
                locationType === ServiceLocationType.MOBILE &&
                selectedClientAddress
                  ? selectedClientAddress.id
                  : null,
              clientAddressSnapshot: clientAddressSnapshotInput,
              clientAddressLatSnapshot:
                locationType === ServiceLocationType.MOBILE &&
                selectedClientAddress
                  ? decimalToNumber(selectedClientAddress.lat)
                  : null,
              clientAddressLngSnapshot:
                locationType === ServiceLocationType.MOBILE &&
                selectedClientAddress
                  ? decimalToNumber(selectedClientAddress.lng)
                  : null,
            },
            select: {
              id: true,
              expiresAt: true,
              scheduledFor: true,
              locationType: true,
              locationId: true,
              locationTimeZone: true,
              clientAddressId: true,
              clientAddressSnapshot: true,
            },
          })

          return {
            ok: true,
            status: 201,
            hold,
          }
        } catch (error: unknown) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            logHoldConflict({
              professionalId: offering.professionalId,
              locationId: locationContext.locationId,
              locationType,
              requestedStart,
              requestedEnd,
              conflictType: 'HOLD',
              offeringId: offering.id,
              clientId,
              clientAddressId,
              meta: {
                prismaCode: error.code,
              },
            })

            return holdFailure('TIME_HELD')
          }

          throw error
        }
      },
    )

    if (!result.ok) {
      return bookingJsonFail(result.code, {
        message: result.message,
        userMessage: result.userMessage,
      })
    }

    return jsonOk({ hold: result.hold }, result.status)
  } catch (error) {
    console.error('POST /api/holds error', error)
    return bookingJsonFail('INTERNAL_ERROR')
  }
}