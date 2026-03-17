// app/api/bookings/finalize/route.ts
import { prisma } from '@/lib/prisma'
import {
  ClientAddressKind,
  Prisma,
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  NotificationType,
  OpeningStatus,
  ServiceLocationType,
} from '@prisma/client'
import { minutesSinceMidnightInTimeZone } from '@/lib/timeZone'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'
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
  decimalFromUnknown,
  decimalToNumber,
  pickFormattedAddressFromSnapshot,
} from '@/lib/booking/snapshots'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'
import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'

export const dynamic = 'force-dynamic'

type TxnErrorCode =
  | 'ADDONS_INVALID'
  | 'ADVANCE_NOTICE_REQUIRED'
  | 'BLOCKED'
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'HOLD_EXPIRED'
  | 'HOLD_MISMATCH'
  | 'HOLD_MISSING_CLIENT_ADDRESS'
  | 'HOLD_MISSING_LOCATION'
  | 'HOLD_NOT_FOUND'
  | 'LOCATION_NOT_FOUND'
  | 'MODE_NOT_SUPPORTED'
  | 'DURATION_REQUIRED'
  | 'PRICE_REQUIRED'
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'SALON_LOCATION_ADDRESS_REQUIRED'
  | 'OPENING_NOT_AVAILABLE'
  | 'TIMEZONE_REQUIRED'
  | 'TIME_IN_PAST'
  | 'TIME_NOT_AVAILABLE'
  | 'TOO_FAR'
  | 'COORDINATES_REQUIRED'

type FinalizeRouteErrorCode =
  | TxnErrorCode
  | 'MISSING_LOCATION_TYPE'
  | 'MISSING_OFFERING'
  | 'HOLD_MISSING'
  | 'MISSING_MEDIA_ID'
  | 'AFTERCARE_TOKEN_MISSING'
  | 'AFTERCARE_TOKEN_INVALID'
  | 'AFTERCARE_NOT_COMPLETED'
  | 'AFTERCARE_CLIENT_MISMATCH'
  | 'AFTERCARE_OFFERING_MISMATCH'
  | 'STEP'
  | 'OUTSIDE_WORKING_HOURS'
  | 'INTERNAL'

function throwCode(code: TxnErrorCode): never {
  throw new Error(code)
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeSourceLoose(args: {
  sourceRaw: unknown
  mediaId: string | null
  aftercareToken: string | null
}): BookingSource {
  const raw =
    typeof args.sourceRaw === 'string' ? args.sourceRaw.trim().toUpperCase() : ''

  if (raw === BookingSource.AFTERCARE) return BookingSource.AFTERCARE
  if (raw === BookingSource.DISCOVERY) return BookingSource.DISCOVERY
  if (raw === BookingSource.REQUESTED) return BookingSource.REQUESTED

  if (raw === 'PROFILE') return BookingSource.REQUESTED
  if (raw === 'UNKNOWN') return BookingSource.REQUESTED

  if (args.aftercareToken) return BookingSource.AFTERCARE
  if (args.mediaId) return BookingSource.DISCOVERY
  return BookingSource.REQUESTED
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 25)
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length
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

function normalizePositiveDurationMinutes(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null

  const minutes = Math.trunc(parsed)
  if (minutes <= 0) return null

  return clampInt(minutes, 15, MAX_SLOT_DURATION_MINUTES)
}

function mapSchedulingReadinessErrorToTxnCode(
  error: SchedulingReadinessError,
): TxnErrorCode {
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

function logAndThrowTimeRangeConflict(args: {
  conflict: 'BLOCKED' | 'BOOKING' | 'HOLD'
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  holdId: string
}): never {
  logBookingConflict({
    action: 'BOOKING_FINALIZE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: args.conflict,
    holdId: args.holdId,
    meta: {
      route: 'app/api/bookings/finalize/route.ts',
    },
  })

  if (args.conflict === 'BLOCKED') {
    throwCode('BLOCKED')
  }

  throwCode('TIME_NOT_AVAILABLE')
}

export async function POST(request: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { clientId, user } = auth

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const offeringId = pickString(body.offeringId)
    const holdId = pickString(body.holdId)
    const mediaId = pickString(body.mediaId)
    const openingId = pickString(body.openingId)
    const aftercareToken = pickString(body.aftercareToken)
    const requestedRebookOfBookingId = pickString(body.rebookOfBookingId)
    const locationType = normalizeLocationType(body.locationType)

    const addOnIds = pickStringArray(body.addOnIds)
    if (hasDuplicates(addOnIds)) {
      return jsonFail(400, 'One or more add-ons are invalid for this booking.', {
        code: 'ADDONS_INVALID' satisfies FinalizeRouteErrorCode,
      })
    }

    if (!locationType) {
      return jsonFail(400, 'Missing locationType.', {
        code: 'MISSING_LOCATION_TYPE' satisfies FinalizeRouteErrorCode,
      })
    }

    if (!offeringId) {
      return jsonFail(400, 'Missing offeringId.', {
        code: 'MISSING_OFFERING' satisfies FinalizeRouteErrorCode,
      })
    }

    if (!holdId) {
      return jsonFail(409, 'Missing hold. Please pick a slot again.', {
        code: 'HOLD_MISSING' satisfies FinalizeRouteErrorCode,
      })
    }

    const source = normalizeSourceLoose({
      sourceRaw: body.source,
      mediaId,
      aftercareToken,
    })

    if (source === BookingSource.DISCOVERY && !mediaId) {
      return jsonFail(400, 'Discovery bookings require a mediaId.', {
        code: 'MISSING_MEDIA_ID' satisfies FinalizeRouteErrorCode,
      })
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        serviceId: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,
        professional: {
          select: { autoAcceptBookings: true },
        },
      },
    })

    if (!offering || !offering.isActive) {
      return jsonFail(400, 'Invalid or inactive offering.', {
        code: 'MISSING_OFFERING' satisfies FinalizeRouteErrorCode,
      })
    }

    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = getClientSubmittedBookingStatus(autoAccept)

    let rebookOfBookingIdForCreate: string | null = null

    if (source === BookingSource.AFTERCARE) {
      if (!aftercareToken) {
        return jsonFail(400, 'Missing aftercare token.', {
          code: 'AFTERCARE_TOKEN_MISSING' satisfies FinalizeRouteErrorCode,
        })
      }

      const aftercare = await prisma.aftercareSummary.findUnique({
        where: { publicToken: aftercareToken },
        select: {
          booking: {
            select: {
              id: true,
              status: true,
              clientId: true,
              professionalId: true,
              serviceId: true,
              offeringId: true,
            },
          },
        },
      })

      if (!aftercare?.booking) {
        return jsonFail(400, 'Invalid aftercare token.', {
          code: 'AFTERCARE_TOKEN_INVALID' satisfies FinalizeRouteErrorCode,
        })
      }

      const original = aftercare.booking

      if (original.status !== BookingStatus.COMPLETED) {
        return jsonFail(409, 'Only COMPLETED bookings can be rebooked.', {
          code: 'AFTERCARE_NOT_COMPLETED' satisfies FinalizeRouteErrorCode,
        })
      }

      if (original.clientId !== clientId) {
        return jsonFail(403, 'Aftercare link does not match this client.', {
          code: 'AFTERCARE_CLIENT_MISMATCH' satisfies FinalizeRouteErrorCode,
        })
      }

      const matchesOffering =
        (original.offeringId && original.offeringId === offering.id) ||
        (original.professionalId === offering.professionalId &&
          original.serviceId === offering.serviceId)

      if (!matchesOffering) {
        return jsonFail(403, 'Aftercare link does not match this offering.', {
          code: 'AFTERCARE_OFFERING_MISMATCH' satisfies FinalizeRouteErrorCode,
        })
      }

      rebookOfBookingIdForCreate =
        requestedRebookOfBookingId && requestedRebookOfBookingId === original.id
          ? requestedRebookOfBookingId
          : original.id
    }

    const booking = await withLockedProfessionalTransaction(
      offering.professionalId,
      async ({ tx, now }) => {
        const hold = await tx.bookingHold.findUnique({
          where: { id: holdId },
          select: {
            id: true,
            offeringId: true,
            professionalId: true,
            clientId: true,
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

        if (!hold) throwCode('HOLD_NOT_FOUND')
        if (hold.clientId !== clientId) throwCode('HOLD_NOT_FOUND')
        if (hold.expiresAt.getTime() <= now.getTime()) throwCode('HOLD_EXPIRED')

        if (hold.offeringId !== offering.id) throwCode('HOLD_MISMATCH')
        if (hold.professionalId !== offering.professionalId) throwCode('HOLD_MISMATCH')
        if (hold.locationType !== locationType) throwCode('HOLD_MISMATCH')
        if (!hold.locationId) throwCode('HOLD_MISSING_LOCATION')

        if (hold.locationType === ServiceLocationType.MOBILE) {
          const clientServiceAddressFromHold = pickFormattedAddressFromSnapshot(
            hold.clientAddressSnapshot,
          )

          if (!hold.clientAddressId || !clientServiceAddressFromHold) {
            throwCode('HOLD_MISSING_CLIENT_ADDRESS')
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
            throwCode('CLIENT_SERVICE_ADDRESS_REQUIRED')
          }
        }

        const validatedContextResult = await resolveValidatedBookingContext({
          tx,
          professionalId: offering.professionalId,
          requestedLocationId: hold.locationId,
          locationType: hold.locationType,
          holdLocationTimeZone: hold.locationTimeZone,
          fallbackTimeZone: 'UTC',
          requireValidTimeZone: true,
          allowFallback: false,
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
          throwCode(mapSchedulingReadinessErrorToTxnCode(validatedContextResult.error))
        }

        const locationContext = validatedContextResult.context
        const baseDurationMinutes = validatedContextResult.durationMinutes
        const priceStartingAt = validatedContextResult.priceStartingAt

        const salonAddressText =
          hold.locationType === ServiceLocationType.SALON
            ? pickFormattedAddressFromSnapshot(hold.locationAddressSnapshot) ??
              normalizeAddress(locationContext.formattedAddress)
            : null

        if (hold.locationType === ServiceLocationType.SALON && !salonAddressText) {
          throwCode('SALON_LOCATION_ADDRESS_REQUIRED')
        }

        const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))
        if (!Number.isFinite(requestedStart.getTime())) {
          throwCode('TIME_IN_PAST')
        }

        if (requestedStart.getTime() < now.getTime()) {
          throwCode('TIME_IN_PAST')
        }

        if (
          requestedStart.getTime() <
          now.getTime() + locationContext.advanceNoticeMinutes * 60_000
        ) {
          throwCode('ADVANCE_NOTICE_REQUIRED')
        }

        if (
          requestedStart.getTime() >
          now.getTime() + locationContext.maxDaysAhead * 24 * 60 * 60_000
        ) {
          throwCode('TOO_FAR')
        }

        const startMinuteOfDay = minutesSinceMidnightInTimeZone(
          requestedStart,
          locationContext.timeZone,
        )

        if (startMinuteOfDay % locationContext.stepMinutes !== 0) {
          logBookingConflict({
            action: 'BOOKING_FINALIZE',
            professionalId: offering.professionalId,
            locationId: locationContext.locationId,
            locationType: hold.locationType,
            requestedStart,
            requestedEnd: addMinutes(requestedStart, 1),
            conflictType: 'STEP_BOUNDARY',
            holdId: hold.id,
            meta: {
              route: 'app/api/bookings/finalize/route.ts',
              stepMinutes: locationContext.stepMinutes,
            },
          })
          throw new Error(`STEP:${locationContext.stepMinutes}`)
        }

        if (openingId) {
          const activeOpening = await tx.lastMinuteOpening.findFirst({
            where: {
              id: openingId,
              status: OpeningStatus.ACTIVE,
            },
            select: {
              id: true,
              startAt: true,
              professionalId: true,
              offeringId: true,
              serviceId: true,
            },
          })

          if (!activeOpening) throwCode('OPENING_NOT_AVAILABLE')
          if (activeOpening.professionalId !== offering.professionalId) {
            throwCode('OPENING_NOT_AVAILABLE')
          }
          if (activeOpening.offeringId && activeOpening.offeringId !== offering.id) {
            throwCode('OPENING_NOT_AVAILABLE')
          }
          if (
            activeOpening.serviceId &&
            activeOpening.serviceId !== offering.serviceId
          ) {
            throwCode('OPENING_NOT_AVAILABLE')
          }
          if (
            normalizeToMinute(new Date(activeOpening.startAt)).getTime() !==
            requestedStart.getTime()
          ) {
            throwCode('OPENING_NOT_AVAILABLE')
          }

          const updated = await tx.lastMinuteOpening.updateMany({
            where: {
              id: openingId,
              status: OpeningStatus.ACTIVE,
            },
            data: {
              status: OpeningStatus.BOOKED,
            },
          })

          if (updated.count !== 1) throwCode('OPENING_NOT_AVAILABLE')
        }

        const addOnLinks = addOnIds.length
          ? await tx.offeringAddOn.findMany({
              where: {
                id: { in: addOnIds },
                offeringId: offering.id,
                isActive: true,
                OR: [{ locationType: null }, { locationType }],
                addOnService: {
                  isActive: true,
                  isAddOnEligible: true,
                },
              },
              select: {
                id: true,
                addOnServiceId: true,
                sortOrder: true,
                priceOverride: true,
                durationOverrideMinutes: true,
                addOnService: {
                  select: {
                    id: true,
                    defaultDurationMinutes: true,
                    minPrice: true,
                  },
                },
              },
              take: 50,
            })
          : []

        if (addOnIds.length && addOnLinks.length !== addOnIds.length) {
          throwCode('ADDONS_INVALID')
        }

        const addOnServiceIds = addOnLinks.map((row) => row.addOnServiceId)

        const proAddOnOfferings = addOnServiceIds.length
          ? await tx.professionalServiceOffering.findMany({
              where: {
                professionalId: offering.professionalId,
                isActive: true,
                serviceId: { in: addOnServiceIds },
              },
              select: {
                serviceId: true,
                salonPriceStartingAt: true,
                salonDurationMinutes: true,
                mobilePriceStartingAt: true,
                mobileDurationMinutes: true,
              },
              take: 200,
            })
          : []

        const addOnOfferingByServiceId = new Map(
          proAddOnOfferings.map((row) => [row.serviceId, row]),
        )

        const resolvedAddOns = addOnLinks.map((row) => {
          const service = row.addOnService
          const proOffering = addOnOfferingByServiceId.get(service.id) ?? null

          const durationRaw =
            row.durationOverrideMinutes ??
            (locationType === ServiceLocationType.MOBILE
              ? proOffering?.mobileDurationMinutes
              : proOffering?.salonDurationMinutes) ??
            service.defaultDurationMinutes

          const durationMinutesSnapshot = normalizePositiveDurationMinutes(durationRaw)

          const priceRaw =
            row.priceOverride ??
            (locationType === ServiceLocationType.MOBILE
              ? proOffering?.mobilePriceStartingAt
              : proOffering?.salonPriceStartingAt) ??
            service.minPrice

          return {
            offeringAddOnId: row.id,
            serviceId: service.id,
            durationMinutesSnapshot,
            priceSnapshot: decimalFromUnknown(priceRaw),
            sortOrder: row.sortOrder ?? 0,
          }
        })

        for (const addOn of resolvedAddOns) {
          if (addOn.durationMinutesSnapshot == null) {
            throwCode('ADDONS_INVALID')
          }
        }

        const basePrice = decimalFromUnknown(priceStartingAt)

        const addOnsPriceTotal = resolvedAddOns.reduce(
          (acc, row) => acc.add(row.priceSnapshot),
          new Prisma.Decimal(0),
        )

        const subtotal = basePrice.add(addOnsPriceTotal)

        const addOnsDurationTotal = resolvedAddOns.reduce(
          (sum, row) => sum + (row.durationMinutesSnapshot ?? 0),
          0,
        )

        const totalDurationMinutes = clampInt(
          baseDurationMinutes + addOnsDurationTotal,
          15,
          MAX_SLOT_DURATION_MINUTES,
        )

        const requestedEnd = addMinutes(
          requestedStart,
          totalDurationMinutes + locationContext.bufferMinutes,
        )

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
          logBookingConflict({
            action: 'BOOKING_FINALIZE',
            professionalId: offering.professionalId,
            locationId: locationContext.locationId,
            locationType: hold.locationType,
            requestedStart,
            requestedEnd,
            conflictType: 'WORKING_HOURS',
            holdId: hold.id,
            meta: {
              route: 'app/api/bookings/finalize/route.ts',
              workingHoursError: workingHoursCheck.error,
            },
          })
          throw new Error(`WH:${workingHoursCheck.error}`)
        }

        const timeRangeConflict = await getTimeRangeConflict({
          tx,
          professionalId: offering.professionalId,
          locationId: locationContext.locationId,
          requestedStart,
          requestedEnd,
          defaultBufferMinutes: locationContext.bufferMinutes,
          fallbackDurationMinutes: totalDurationMinutes,
          excludeHoldId: hold.id,
        })

        if (timeRangeConflict) {
          logAndThrowTimeRangeConflict({
            conflict: timeRangeConflict,
            professionalId: offering.professionalId,
            locationId: locationContext.locationId,
            locationType: hold.locationType,
            requestedStart,
            requestedEnd,
            holdId: hold.id,
          })
        }

        const salonLocationAddressSnapshotInput:
          | Prisma.InputJsonValue
          | Prisma.NullableJsonNullValueInput =
          hold.locationType === ServiceLocationType.SALON && salonAddressText
            ? buildAddressSnapshot(salonAddressText) ?? Prisma.JsonNull
            : Prisma.JsonNull

        let created: {
          id: string
          status: BookingStatus
          scheduledFor: Date
          professionalId: string
        }

        try {
          created = await tx.booking.create({
            data: {
              clientId,
              professionalId: offering.professionalId,
              serviceId: offering.serviceId,
              offeringId: offering.id,
              scheduledFor: requestedStart,
              status: initialStatus,
              source,
              locationType,
              rebookOfBookingId: rebookOfBookingIdForCreate,
              subtotalSnapshot: subtotal,
              totalDurationMinutes,
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
              professionalId: true,
            },
          })
        } catch (error: unknown) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throwCode('TIME_NOT_AVAILABLE')
          }
          throw error
        }

        const baseItem = await tx.bookingServiceItem.create({
          data: {
            bookingId: created.id,
            serviceId: offering.serviceId,
            offeringId: offering.id,
            itemType: BookingServiceItemType.BASE,
            priceSnapshot: basePrice,
            durationMinutesSnapshot: baseDurationMinutes,
            sortOrder: 0,
          },
          select: { id: true },
        })

        if (resolvedAddOns.length) {
          await tx.bookingServiceItem.createMany({
            data: resolvedAddOns.map((row, index) => ({
              bookingId: created.id,
              serviceId: row.serviceId,
              offeringId: null,
              itemType: BookingServiceItemType.ADD_ON,
              parentItemId: baseItem.id,
              priceSnapshot: row.priceSnapshot,
              durationMinutesSnapshot: row.durationMinutesSnapshot ?? 0,
              sortOrder: index + 1,
              notes: `ADDON:${row.offeringAddOnId}`,
            })),
          })
        }

        if (openingId) {
          await tx.openingNotification.updateMany({
            where: {
              clientId,
              openingId,
              bookedAt: null,
            },
            data: {
              bookedAt: new Date(),
            },
          })
        }

        await tx.bookingHold.delete({
          where: { id: hold.id },
        })

        return created
      },
    )

    const notificationType =
      booking.status === BookingStatus.PENDING
        ? NotificationType.BOOKING_REQUEST
        : NotificationType.BOOKING_UPDATE

    await createProNotification({
      professionalId: booking.professionalId,
      type: notificationType,
      title:
        notificationType === NotificationType.BOOKING_REQUEST
          ? 'New booking request'
          : 'New booking confirmed',
      body: '',
      href: `/pro/bookings/${booking.id}`,
      actorUserId: user.id,
      bookingId: booking.id,
      dedupeKey: `PRO_NOTIF:${String(notificationType)}:${booking.id}`,
    })

    return jsonOk({ booking }, 201)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'ADDONS_INVALID') {
      return jsonFail(400, 'One or more add-ons are invalid for this booking.', {
        code: 'ADDONS_INVALID' satisfies FinalizeRouteErrorCode,
      })
    }

    if (message === 'HOLD_MISSING_CLIENT_ADDRESS') {
      return jsonFail(
        409,
        'This mobile hold is missing the service address. Please pick your address and try again.',
        { code: 'HOLD_MISSING_CLIENT_ADDRESS' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'ADVANCE_NOTICE_REQUIRED') {
      return jsonFail(
        400,
        'That slot is too soon. Please choose a later time.',
        { code: 'ADVANCE_NOTICE_REQUIRED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'CLIENT_SERVICE_ADDRESS_REQUIRED') {
      return jsonFail(
        400,
        'Add a mobile service address in your client settings before booking an in-home appointment.',
        { code: 'CLIENT_SERVICE_ADDRESS_REQUIRED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'SALON_LOCATION_ADDRESS_REQUIRED') {
      return jsonFail(
        400,
        'This salon location is missing an address. Please update the professional location before booking.',
        { code: 'SALON_LOCATION_ADDRESS_REQUIRED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'TIMEZONE_REQUIRED') {
      return jsonFail(
        400,
        'This professional must set a valid timezone before taking bookings.',
        { code: 'TIMEZONE_REQUIRED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'WORKING_HOURS_REQUIRED') {
      return jsonFail(
        400,
        'This professional has not set working hours yet.',
        { code: 'WORKING_HOURS_REQUIRED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'WORKING_HOURS_INVALID') {
      return jsonFail(
        400,
        'This professional’s working hours are misconfigured.',
        { code: 'WORKING_HOURS_INVALID' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'MODE_NOT_SUPPORTED') {
      return jsonFail(
        400,
        'This service is not available for the selected booking type.',
        { code: 'MODE_NOT_SUPPORTED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'DURATION_REQUIRED') {
      return jsonFail(
        400,
        'This service is missing duration settings for the selected booking type.',
        { code: 'DURATION_REQUIRED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'PRICE_REQUIRED') {
      return jsonFail(
        400,
        'This service is missing pricing for the selected booking type.',
        { code: 'PRICE_REQUIRED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'COORDINATES_REQUIRED') {
      return jsonFail(
        400,
        'This location is missing coordinates required for this booking flow.',
        { code: 'COORDINATES_REQUIRED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'OPENING_NOT_AVAILABLE') {
      return jsonFail(
        409,
        'That opening was just taken. Please pick another slot.',
        { code: 'OPENING_NOT_AVAILABLE' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'TIME_NOT_AVAILABLE') {
      return jsonFail(
        409,
        'That time is no longer available. Please select a different slot.',
        { code: 'TIME_NOT_AVAILABLE' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'BLOCKED') {
      return jsonFail(
        409,
        'That time is blocked. Please select a different slot.',
        { code: 'BLOCKED' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'HOLD_NOT_FOUND') {
      return jsonFail(409, 'Hold not found. Please pick a slot again.', {
        code: 'HOLD_NOT_FOUND' satisfies FinalizeRouteErrorCode,
      })
    }

    if (message === 'HOLD_EXPIRED') {
      return jsonFail(409, 'Hold expired. Please pick a slot again.', {
        code: 'HOLD_EXPIRED' satisfies FinalizeRouteErrorCode,
      })
    }

    if (message === 'HOLD_MISMATCH') {
      return jsonFail(409, 'Hold mismatch. Please pick a slot again.', {
        code: 'HOLD_MISMATCH' satisfies FinalizeRouteErrorCode,
      })
    }

    if (message === 'HOLD_MISSING_LOCATION') {
      return jsonFail(409, 'Hold is missing location info. Please pick a slot again.', {
        code: 'HOLD_MISSING_LOCATION' satisfies FinalizeRouteErrorCode,
      })
    }

    if (message === 'LOCATION_NOT_FOUND') {
      return jsonFail(
        409,
        'This location is no longer available. Please pick another slot.',
        { code: 'LOCATION_NOT_FOUND' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message === 'TIME_IN_PAST') {
      return jsonFail(400, 'Please select a future time.', {
        code: 'TIME_IN_PAST' satisfies FinalizeRouteErrorCode,
      })
    }

    if (message === 'TOO_FAR') {
      return jsonFail(400, 'That date is too far in the future.', {
        code: 'TOO_FAR' satisfies FinalizeRouteErrorCode,
      })
    }

    if (message.startsWith('STEP:')) {
      return jsonFail(
        400,
        `Start time must be on a ${message.slice(5)}-minute boundary.`,
        { code: 'STEP' satisfies FinalizeRouteErrorCode },
      )
    }

    if (message.startsWith('WH:')) {
      return jsonFail(
        400,
        message.slice(3) || 'That time is outside working hours.',
        { code: 'OUTSIDE_WORKING_HOURS' satisfies FinalizeRouteErrorCode },
      )
    }

    console.error('POST /api/bookings/finalize error:', error)
    return jsonFail(500, 'Internal server error', {
      code: 'INTERNAL' satisfies FinalizeRouteErrorCode,
    })
  }
}