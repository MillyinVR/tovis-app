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
import {
  normalizeLocationType,
  resolveValidatedBookingContext,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalToNumber,
} from '@/lib/booking/snapshots'
import { minutesSinceMidnightInTimeZone } from '@/lib/timeZone'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'

export const dynamic = 'force-dynamic'

type HoldRouteErrorCode =
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'CLIENT_SERVICE_ADDRESS_INVALID'
  | 'SALON_LOCATION_ADDRESS_REQUIRED'
  | 'LOCATION_NOT_FOUND'
  | 'TIMEZONE_REQUIRED'
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'MODE_NOT_SUPPORTED'
  | 'DURATION_REQUIRED'
  | 'PRICE_REQUIRED'
  | 'COORDINATES_REQUIRED'

type HoldCreateFailure = {
  ok: false
  status: number
  error: string
  code?: HoldRouteErrorCode
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

function mapSchedulingReadinessFailure(
  error: SchedulingReadinessError,
): HoldCreateFailure {
  switch (error) {
    case 'LOCATION_NOT_FOUND':
      return {
        ok: false,
        status: 404,
        error: 'Location not found or not bookable.',
        code: 'LOCATION_NOT_FOUND',
      }

    case 'TIMEZONE_REQUIRED':
      return {
        ok: false,
        status: 400,
        error: 'This professional must set a valid timezone before taking bookings.',
        code: 'TIMEZONE_REQUIRED',
      }

    case 'WORKING_HOURS_REQUIRED':
      return {
        ok: false,
        status: 400,
        error: 'This professional has not set working hours yet.',
        code: 'WORKING_HOURS_REQUIRED',
      }

    case 'WORKING_HOURS_INVALID':
      return {
        ok: false,
        status: 400,
        error: 'This professional’s working hours are misconfigured.',
        code: 'WORKING_HOURS_INVALID',
      }

    case 'MODE_NOT_SUPPORTED':
      return {
        ok: false,
        status: 400,
        error: 'This service is not available for the selected booking type.',
        code: 'MODE_NOT_SUPPORTED',
      }

    case 'DURATION_REQUIRED':
      return {
        ok: false,
        status: 400,
        error:
          'This service is missing duration settings for the selected booking type.',
        code: 'DURATION_REQUIRED',
      }

    case 'PRICE_REQUIRED':
      return {
        ok: false,
        status: 400,
        error:
          'This service is missing pricing for the selected booking type.',
        code: 'PRICE_REQUIRED',
      }

    case 'COORDINATES_REQUIRED':
      return {
        ok: false,
        status: 400,
        error:
          'This location is missing coordinates required for this booking flow.',
        code: 'COORDINATES_REQUIRED',
      }
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

    if (!offeringId || !scheduledForRaw || !locationType) {
      return jsonFail(400, 'Missing offeringId, scheduledFor, or locationType.')
    }

    if (
      locationType === ServiceLocationType.MOBILE &&
      !clientAddressId
    ) {
      return jsonFail(
        400,
        'Select a saved service address before booking a mobile appointment.',
        { code: 'CLIENT_SERVICE_ADDRESS_REQUIRED' },
      )
    }

    const scheduledForParsed = new Date(scheduledForRaw)
    if (!isValidDate(scheduledForParsed)) {
      return jsonFail(400, 'Invalid scheduledFor.')
    }

    const now = new Date()
    const requestedStart = normalizeToMinute(scheduledForParsed)

    if (requestedStart.getTime() < now.getTime() + 60_000) {
      return jsonFail(400, 'Please select a future time.')
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
      },
    })

    if (!offering || !offering.isActive) {
      return jsonFail(404, 'Offering not found.')
    }

    const result = await prisma.$transaction(
      async (tx): Promise<HoldCreateResult> => {
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
            return {
              ok: false,
              status: 400,
              error:
                'Add or select a valid mobile service address in your client settings before booking an in-home appointment.',
              code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
            }
          }

          if (!clientServiceAddress) {
            return {
              ok: false,
              status: 400,
              error:
                'That service address is missing a formatted address. Please update it before booking mobile.',
              code: 'CLIENT_SERVICE_ADDRESS_INVALID',
            }
          }
        }

        const validatedContextResult = await resolveValidatedBookingContext({
          tx,
          professionalId: offering.professionalId,
          requestedLocationId,
          locationType,
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
          return {
            ok: false,
            status: 400,
            error:
              'This salon location is missing an address. Please update the professional location before booking.',
            code: 'SALON_LOCATION_ADDRESS_REQUIRED',
          }
        }

        const requestedEnd = addMinutes(
          requestedStart,
          durationMinutes + locationContext.bufferMinutes,
        )

        if (
          requestedStart.getTime() <
          now.getTime() + locationContext.advanceNoticeMinutes * 60_000
        ) {
          return {
            ok: false,
            status: 400,
            error: 'Please pick a later time.',
          }
        }

        if (
          requestedStart.getTime() >
          now.getTime() + locationContext.maxDaysAhead * 24 * 60 * 60_000
        ) {
          return {
            ok: false,
            status: 400,
            error: 'That date is too far in the future.',
          }
        }

        const startMinuteOfDay = minutesSinceMidnightInTimeZone(
          requestedStart,
          locationContext.timeZone,
        )

        if (startMinuteOfDay % locationContext.stepMinutes !== 0) {
          return {
            ok: false,
            status: 400,
            error: `Start time must be on a ${locationContext.stepMinutes}-minute boundary.`,
          }
        }

        const workingHoursCheck = ensureWithinWorkingHours({
          scheduledStartUtc: requestedStart,
          scheduledEndUtc: requestedEnd,
          workingHours: locationContext.workingHours,
          timeZone: locationContext.timeZone,
          fallbackTimeZone: 'UTC',
          messages: {
            missing: 'This professional has not set working hours yet.',
            outside: 'That time is outside this professional’s working hours.',
            misconfigured: 'This professional’s working hours are misconfigured.',
          },
        })

        if (!workingHoursCheck.ok) {
          return {
            ok: false,
            status: 400,
            error: workingHoursCheck.error,
          }
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
          return {
            ok: false,
            status: 409,
            error: 'That time is blocked. Try another slot.',
          }
        }

        if (conflict === 'BOOKING') {
          return {
            ok: false,
            status: 409,
            error: 'That time was just taken.',
          }
        }

        if (conflict === 'HOLD') {
          return {
            ok: false,
            status: 409,
            error: 'Someone is already holding that time. Try another slot.',
          }
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

              // For SALON, this is the actual appointment address.
              // For MOBILE, the actual destination lives in clientAddressSnapshot.
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
            return {
              ok: false,
              status: 409,
              error: 'Someone is already holding that time. Try another slot.',
            }
          }

          throw error
        }
      },
    )

    if (!result.ok) {
      return jsonFail(
        result.status,
        result.error,
        result.code ? { code: result.code } : undefined,
      )
    }

    return jsonOk({ hold: result.hold }, result.status)
  } catch (error) {
    console.error('POST /api/holds error', error)
    return jsonFail(500, 'Failed to create hold.')
  }
}