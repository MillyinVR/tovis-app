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
import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import {
  checkSlotReadiness,
  type SlotReadinessCode,
} from '@/lib/booking/slotReadiness'
import { withLockedProfessionalTransaction } from '@/lib/booking/scheduleTransaction'
import {
  bookingError,
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'

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

function mapSlotReadinessCodeToBookingCode(
  code: SlotReadinessCode,
): BookingErrorCode {
  switch (code) {
    case 'STEP_MISMATCH':
      return 'STEP_MISMATCH'
    case 'ADVANCE_NOTICE_REQUIRED':
      return 'ADVANCE_NOTICE_REQUIRED'
    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return 'MAX_DAYS_AHEAD_EXCEEDED'
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'OUTSIDE_WORKING_HOURS':
      return 'OUTSIDE_WORKING_HOURS'
    case 'INVALID_START':
      return 'INVALID_SCHEDULED_FOR'
    case 'INVALID_DURATION':
      return 'INVALID_DURATION'
    case 'INVALID_BUFFER':
      return 'INTERNAL_ERROR'
    case 'INVALID_RANGE':
      return 'INVALID_SCHEDULED_FOR'
  }
}

function logAndThrowSlotReadinessFailure(args: {
  code: SlotReadinessCode
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  requestedStart: Date
  requestedEnd: Date
  holdId: string
  stepMinutes: number
  meta?: Record<string, unknown>
}): never {
  const conflictType =
    args.code === 'STEP_MISMATCH'
      ? 'STEP_BOUNDARY'
      : args.code === 'WORKING_HOURS_REQUIRED' ||
          args.code === 'WORKING_HOURS_INVALID' ||
          args.code === 'OUTSIDE_WORKING_HOURS'
        ? 'WORKING_HOURS'
        : 'TIME_NOT_AVAILABLE'

  logBookingConflict({
    action: 'BOOKING_FINALIZE',
    professionalId: args.professionalId,
    locationId: args.locationId,
    locationType: args.locationType,
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType,
    holdId: args.holdId,
    meta: {
      route: 'app/api/bookings/finalize/route.ts',
      slotReadinessCode: args.code,
      stepMinutes: args.stepMinutes,
      ...(args.meta ?? {}),
    },
  })

  if (args.code === 'STEP_MISMATCH') {
    throw bookingError('STEP_MISMATCH', {
      message: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
      userMessage: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
    })
  }

  if (args.code === 'OUTSIDE_WORKING_HOURS') {
    const workingHoursError =
      typeof args.meta?.workingHoursError === 'string'
        ? args.meta.workingHoursError
        : 'That time is outside working hours.'

    throw bookingError('OUTSIDE_WORKING_HOURS', {
      message: workingHoursError,
      userMessage: workingHoursError,
    })
  }

  throw bookingError(mapSlotReadinessCodeToBookingCode(args.code))
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

  switch (args.conflict) {
    case 'BLOCKED':
      throw bookingError('TIME_BLOCKED')
    case 'BOOKING':
      throw bookingError('TIME_BOOKED')
    case 'HOLD':
      throw bookingError('TIME_HELD')
  }
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
      return bookingJsonFail('ADDONS_INVALID')
    }

    if (!locationType) {
      return bookingJsonFail('LOCATION_TYPE_REQUIRED')
    }

    if (!offeringId) {
      return bookingJsonFail('OFFERING_ID_REQUIRED')
    }

    if (!holdId) {
      return bookingJsonFail('HOLD_ID_REQUIRED')
    }

    const source = normalizeSourceLoose({
      sourceRaw: body.source,
      mediaId,
      aftercareToken,
    })

    if (source === BookingSource.DISCOVERY && !mediaId) {
      return bookingJsonFail('MISSING_MEDIA_ID')
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
          select: {
            autoAcceptBookings: true,
            timeZone: true,
          },
        },
      },
    })

    if (!offering || !offering.isActive) {
      return bookingJsonFail('OFFERING_NOT_FOUND')
    }

    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = getClientSubmittedBookingStatus(autoAccept)

    let rebookOfBookingIdForCreate: string | null = null

    if (source === BookingSource.AFTERCARE) {
      if (!aftercareToken) {
        return bookingJsonFail('AFTERCARE_TOKEN_MISSING')
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
        return bookingJsonFail('AFTERCARE_TOKEN_INVALID')
      }

      const original = aftercare.booking

      if (original.status !== BookingStatus.COMPLETED) {
        return bookingJsonFail('AFTERCARE_NOT_COMPLETED')
      }

      if (original.clientId !== clientId) {
        return bookingJsonFail('AFTERCARE_CLIENT_MISMATCH')
      }

      const matchesOffering =
        (original.offeringId && original.offeringId === offering.id) ||
        (original.professionalId === offering.professionalId &&
          original.serviceId === offering.serviceId)

      if (!matchesOffering) {
        return bookingJsonFail('AFTERCARE_OFFERING_MISMATCH')
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

        if (!hold) throw bookingError('HOLD_NOT_FOUND')
        if (hold.clientId !== clientId) throw bookingError('HOLD_NOT_FOUND')
        if (hold.expiresAt.getTime() <= now.getTime()) {
          throw bookingError('HOLD_EXPIRED')
        }

        if (hold.offeringId !== offering.id) throw bookingError('HOLD_MISMATCH')
        if (hold.professionalId !== offering.professionalId) {
          throw bookingError('HOLD_MISMATCH')
        }
        if (hold.locationType !== locationType) throw bookingError('HOLD_MISMATCH')
        if (!hold.locationId) throw bookingError('HOLD_MISMATCH')

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
          professionalId: offering.professionalId,
          requestedLocationId: hold.locationId,
          locationType: hold.locationType,
          holdLocationTimeZone: hold.locationTimeZone,
          professionalTimeZone: offering.professional?.timeZone ?? null,
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
          throw bookingError(
            mapSchedulingReadinessErrorToBookingCode(validatedContextResult.error),
          )
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
          throw bookingError('SALON_LOCATION_ADDRESS_REQUIRED')
        }

        const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))
        if (!Number.isFinite(requestedStart.getTime())) {
          throw bookingError('INVALID_SCHEDULED_FOR')
        }

        if (requestedStart.getTime() < now.getTime()) {
          throw bookingError('TIME_IN_PAST')
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

          if (!activeOpening) throw bookingError('OPENING_NOT_AVAILABLE')
          if (activeOpening.professionalId !== offering.professionalId) {
            throw bookingError('OPENING_NOT_AVAILABLE')
          }
          if (activeOpening.offeringId && activeOpening.offeringId !== offering.id) {
            throw bookingError('OPENING_NOT_AVAILABLE')
          }
          if (
            activeOpening.serviceId &&
            activeOpening.serviceId !== offering.serviceId
          ) {
            throw bookingError('OPENING_NOT_AVAILABLE')
          }
          if (
            normalizeToMinute(new Date(activeOpening.startAt)).getTime() !==
            requestedStart.getTime()
          ) {
            throw bookingError('OPENING_NOT_AVAILABLE')
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

          if (updated.count !== 1) throw bookingError('OPENING_NOT_AVAILABLE')
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
          throw bookingError('ADDONS_INVALID')
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
            throw bookingError('ADDONS_INVALID')
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

        const slotReadiness = checkSlotReadiness({
          startUtc: requestedStart,
          nowUtc: now,
          durationMinutes: totalDurationMinutes,
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
              totalDurationMinutes + locationContext.bufferMinutes,
            )

        if (!slotReadiness.ok) {
          logAndThrowSlotReadinessFailure({
            code: slotReadiness.code,
            professionalId: offering.professionalId,
            locationId: locationContext.locationId,
            locationType: hold.locationType,
            requestedStart,
            requestedEnd,
            holdId: hold.id,
            stepMinutes: locationContext.stepMinutes,
            meta: slotReadiness.meta,
          })
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
            throw bookingError('TIME_NOT_AVAILABLE')
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
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/bookings/finalize error:', error)
    return bookingJsonFail('INTERNAL_ERROR', {
      message: error instanceof Error ? error.message : 'Internal server error',
      userMessage: 'Internal server error',
    })
  }
}