// app/api/bookings/finalize/route.ts
import { prisma } from '@/lib/prisma'
import {
  Prisma,
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  NotificationType,
  OpeningStatus,
  ServiceLocationType,
} from '@prisma/client'
import {
  sanitizeTimeZone,
  minutesSinceMidnightInTimeZone,
  isValidIanaTimeZone,
} from '@/lib/timeZone'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { isRecord } from '@/lib/guards'
import { clampInt } from '@/lib/pick'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_ADVANCE_NOTICE_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_DAYS_AHEAD,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import {
  findCalendarBlockConflict,
  hasBookingConflict,
  hasHoldConflict,
} from '@/lib/booking/conflictQueries'
import {
  normalizeLocationType,
  normalizeStepMinutes,
  pickModeDurationMinutes,
} from '@/lib/booking/locationContext'
import {
  buildAddressSnapshot,
  decimalFromUnknown,
  decimalToNumber,
  pickFormattedAddressFromSnapshot,
} from '@/lib/booking/snapshots'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'

export const dynamic = 'force-dynamic'

type TxnErrorCode =
  | 'ADDONS_INVALID'
  | 'BLOCKED'
  | 'HOLD_EXPIRED'
  | 'HOLD_MISMATCH'
  | 'HOLD_MISSING_LOCATION'
  | 'HOLD_NOT_FOUND'
  | 'INVALID_DURATION'
  | 'LOCATION_NOT_FOUND'
  | 'OPENING_NOT_AVAILABLE'
  | 'TIMEZONE_REQUIRED'
  | 'TIME_IN_PAST'
  | 'TIME_NOT_AVAILABLE'
  | 'TOO_FAR'

function throwCode(code: TxnErrorCode): never {
  throw new Error(code)
}

type FinalizeBookingBody = {
  offeringId?: unknown
  holdId?: unknown
  source?: unknown
  locationType?: unknown
  mediaId?: unknown
  openingId?: unknown
  aftercareToken?: unknown
  rebookOfBookingId?: unknown
  addOnIds?: unknown
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
        code: 'ADDONS_INVALID',
      })
    }

    if (!locationType) {
      return jsonFail(400, 'Missing locationType.', {
        code: 'MISSING_LOCATION_TYPE',
      })
    }

    if (!offeringId) {
      return jsonFail(400, 'Missing offeringId.', {
        code: 'MISSING_OFFERING',
      })
    }

    if (!holdId) {
      return jsonFail(409, 'Missing hold. Please pick a slot again.', {
        code: 'HOLD_MISSING',
      })
    }

    const source = normalizeSourceLoose({
      sourceRaw: body.source,
      mediaId,
      aftercareToken,
    })

    if (source === BookingSource.DISCOVERY && !mediaId) {
      return jsonFail(400, 'Discovery bookings require a mediaId.', {
        code: 'MISSING_MEDIA_ID',
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
        code: 'OFFERING_INACTIVE',
      })
    }

    if (locationType === ServiceLocationType.SALON && !offering.offersInSalon) {
      return jsonFail(400, 'This service is not offered in-salon.', {
        code: 'MODE_NOT_SUPPORTED',
      })
    }

    if (locationType === ServiceLocationType.MOBILE && !offering.offersMobile) {
      return jsonFail(400, 'This service is not offered as mobile.', {
        code: 'MODE_NOT_SUPPORTED',
      })
    }

    const priceStartingAt =
      locationType === ServiceLocationType.MOBILE
        ? offering.mobilePriceStartingAt
        : offering.salonPriceStartingAt

    if (priceStartingAt == null) {
      return jsonFail(
        400,
        `Pricing is not set for ${
          locationType === ServiceLocationType.MOBILE ? 'mobile' : 'salon'
        } bookings.`,
        { code: 'PRICING_NOT_SET' },
      )
    }

    const baseDurationMinutes = pickModeDurationMinutes({
      locationType,
      salonDurationMinutes: offering.salonDurationMinutes,
      mobileDurationMinutes: offering.mobileDurationMinutes,
    })

    if (!Number.isFinite(baseDurationMinutes) || baseDurationMinutes <= 0) {
      return jsonFail(400, 'Offering duration is invalid for this booking type.', {
        code: 'INVALID_DURATION',
      })
    }

    const now = new Date()
    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = autoAccept ? BookingStatus.ACCEPTED : BookingStatus.PENDING

    let rebookOfBookingIdForCreate: string | null = null

    if (source === BookingSource.AFTERCARE) {
      if (!aftercareToken) {
        return jsonFail(400, 'Missing aftercare token.', {
          code: 'AFTERCARE_TOKEN_MISSING',
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
          code: 'AFTERCARE_TOKEN_INVALID',
        })
      }

      const original = aftercare.booking

      if (original.status !== BookingStatus.COMPLETED) {
        return jsonFail(409, 'Only COMPLETED bookings can be rebooked.', {
          code: 'AFTERCARE_NOT_COMPLETED',
        })
      }

      if (original.clientId !== clientId) {
        return jsonFail(403, 'Aftercare link does not match this client.', {
          code: 'AFTERCARE_CLIENT_MISMATCH',
        })
      }

      const matchesOffering =
        (original.offeringId && original.offeringId === offering.id) ||
        (original.professionalId === offering.professionalId &&
          original.serviceId === offering.serviceId)

      if (!matchesOffering) {
        return jsonFail(403, 'Aftercare link does not match this offering.', {
          code: 'AFTERCARE_OFFERING_MISMATCH',
        })
      }

      rebookOfBookingIdForCreate =
        requestedRebookOfBookingId && requestedRebookOfBookingId === original.id
          ? requestedRebookOfBookingId
          : original.id
    }

    const booking = await prisma.$transaction(async (tx) => {
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
        },
      })

      if (!hold) throwCode('HOLD_NOT_FOUND')
      if (hold.clientId !== clientId) throwCode('HOLD_NOT_FOUND')
      if (hold.expiresAt.getTime() <= now.getTime()) throwCode('HOLD_EXPIRED')

      if (hold.offeringId !== offering.id) throwCode('HOLD_MISMATCH')
      if (hold.professionalId !== offering.professionalId) throwCode('HOLD_MISMATCH')
      if (hold.locationType !== locationType) throwCode('HOLD_MISMATCH')
      if (!hold.locationId) throwCode('HOLD_MISSING_LOCATION')

      const location = await tx.professionalLocation.findFirst({
        where: {
          id: hold.locationId,
          professionalId: offering.professionalId,
          isBookable: true,
        },
        select: {
          id: true,
          timeZone: true,
          workingHours: true,
          bufferMinutes: true,
          stepMinutes: true,
          advanceNoticeMinutes: true,
          maxDaysAhead: true,
          formattedAddress: true,
          lat: true,
          lng: true,
        },
      })

      if (!location) throwCode('LOCATION_NOT_FOUND')

      const tzResult = await resolveApptTimeZone({
        holdLocationTimeZone: hold.locationTimeZone,
        location: { id: location.id, timeZone: location.timeZone },
        professionalId: offering.professionalId,
        fallback: 'UTC',
        requireValid: true,
      })

      if (!tzResult.ok) throwCode('TIMEZONE_REQUIRED')

      const appointmentTimeZone = sanitizeTimeZone(tzResult.timeZone, 'UTC')
      if (!isValidIanaTimeZone(appointmentTimeZone)) {
        throwCode('TIMEZONE_REQUIRED')
      }

      const bufferMinutes = clampInt(
        Number(location.bufferMinutes ?? 0),
        0,
        MAX_BUFFER_MINUTES,
      )

      const stepMinutes = normalizeStepMinutes(location.stepMinutes, 15)

      const advanceNoticeMinutes = clampInt(
        Number(location.advanceNoticeMinutes ?? 15),
        0,
        MAX_ADVANCE_NOTICE_MINUTES,
      )

      const maxDaysAhead = clampInt(
        Number(location.maxDaysAhead ?? 365),
        1,
        MAX_DAYS_AHEAD,
      )

      const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (!Number.isFinite(requestedStart.getTime())) {
        throwCode('TIME_IN_PAST')
      }

      if (requestedStart.getTime() < now.getTime() + advanceNoticeMinutes * 60_000) {
        throwCode('TIME_IN_PAST')
      }

      if (requestedStart.getTime() > now.getTime() + maxDaysAhead * 24 * 60 * 60_000) {
        throwCode('TOO_FAR')
      }

      const startMinuteOfDay = minutesSinceMidnightInTimeZone(
        requestedStart,
        appointmentTimeZone,
      )

      if (startMinuteOfDay % stepMinutes !== 0) {
        throw new Error(`STEP:${stepMinutes}`)
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
        if (activeOpening.serviceId && activeOpening.serviceId !== offering.serviceId) {
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

        const durationMinutesSnapshot = pickModeDurationMinutes({
          locationType,
          salonDurationMinutes:
            row.durationOverrideMinutes ??
            proOffering?.salonDurationMinutes ??
            service.defaultDurationMinutes ??
            null,
          mobileDurationMinutes:
            row.durationOverrideMinutes ??
            proOffering?.mobileDurationMinutes ??
            service.defaultDurationMinutes ??
            null,
        })

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
        if (
          !Number.isFinite(addOn.durationMinutesSnapshot) ||
          addOn.durationMinutesSnapshot <= 0
        ) {
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
        (sum, row) => sum + row.durationMinutesSnapshot,
        0,
      )

      const totalDurationMinutes = clampInt(
        baseDurationMinutes + addOnsDurationTotal,
        15,
        MAX_SLOT_DURATION_MINUTES,
      )

      const requestedEnd = addMinutes(
        requestedStart,
        totalDurationMinutes + bufferMinutes,
      )

      const workingHoursCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: location.workingHours,
        timeZone: appointmentTimeZone,
        fallbackTimeZone: 'UTC',
        messages: {
          missing: 'This professional has not set working hours yet.',
          outside: 'That time is outside this professional’s working hours.',
          misconfigured: 'This professional’s working hours are misconfigured.',
        },
      })

      if (!workingHoursCheck.ok) {
        throw new Error(`WH:${workingHoursCheck.error}`)
      }

      const blockConflict = await findCalendarBlockConflict({
        tx,
        professionalId: offering.professionalId,
        locationId: location.id,
        requestedStart,
        requestedEnd,
      })

      if (blockConflict) throwCode('BLOCKED')

      const bookingConflict = await hasBookingConflict({
        tx,
        professionalId: offering.professionalId,
        requestedStart,
        requestedEnd,
      })

      if (bookingConflict) throwCode('TIME_NOT_AVAILABLE')

      const holdConflict = await hasHoldConflict({
        tx,
        professionalId: offering.professionalId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: bufferMinutes,
        excludeHoldId: hold.id,
        fallbackDurationMinutes: DEFAULT_DURATION_MINUTES,
      })

      if (holdConflict) throwCode('TIME_NOT_AVAILABLE')

      const formattedAddressFromHold = pickFormattedAddressFromSnapshot(
        hold.locationAddressSnapshot,
      )

      const addressSnapshot = buildAddressSnapshot(
        formattedAddressFromHold ?? location.formattedAddress,
      )

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
            bufferMinutes,

            locationId: location.id,
            locationTimeZone: appointmentTimeZone,
            locationAddressSnapshot: addressSnapshot,
            locationLatSnapshot:
              hold.locationLatSnapshot ?? decimalToNumber(location.lat),
            locationLngSnapshot:
              hold.locationLngSnapshot ?? decimalToNumber(location.lng),
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
          data: resolvedAddOns.map((row) => ({
            bookingId: created.id,
            serviceId: row.serviceId,
            offeringId: null,
            itemType: BookingServiceItemType.ADD_ON,
            parentItemId: baseItem.id,
            priceSnapshot: row.priceSnapshot,
            durationMinutesSnapshot: row.durationMinutesSnapshot,
            sortOrder: 100 + row.sortOrder,
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
    })

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
        code: 'ADDONS_INVALID',
      })
    }

    if (message === 'TIMEZONE_REQUIRED') {
      return jsonFail(
        400,
        'This professional must set a valid timezone before taking bookings.',
        { code: 'TIMEZONE_REQUIRED' },
      )
    }

    if (message === 'OPENING_NOT_AVAILABLE') {
      return jsonFail(409, 'That opening was just taken. Please pick another slot.', {
        code: 'OPENING_NOT_AVAILABLE',
      })
    }

    if (message === 'TIME_NOT_AVAILABLE') {
      return jsonFail(
        409,
        'That time is no longer available. Please select a different slot.',
        { code: 'TIME_NOT_AVAILABLE' },
      )
    }

    if (message === 'BLOCKED') {
      return jsonFail(409, 'That time is blocked. Please select a different slot.', {
        code: 'BLOCKED',
      })
    }

    if (message === 'HOLD_NOT_FOUND') {
      return jsonFail(409, 'Hold not found. Please pick a slot again.', {
        code: 'HOLD_NOT_FOUND',
      })
    }

    if (message === 'HOLD_EXPIRED') {
      return jsonFail(409, 'Hold expired. Please pick a slot again.', {
        code: 'HOLD_EXPIRED',
      })
    }

    if (message === 'HOLD_MISMATCH') {
      return jsonFail(409, 'Hold mismatch. Please pick a slot again.', {
        code: 'HOLD_MISMATCH',
      })
    }

    if (message === 'HOLD_MISSING_LOCATION') {
      return jsonFail(409, 'Hold is missing location info. Please pick a slot again.', {
        code: 'HOLD_MISSING_LOCATION',
      })
    }

    if (message === 'LOCATION_NOT_FOUND') {
      return jsonFail(
        409,
        'This location is no longer available. Please pick another slot.',
        { code: 'LOCATION_NOT_FOUND' },
      )
    }

    if (message === 'TIME_IN_PAST') {
      return jsonFail(400, 'Please select a future time.', {
        code: 'TIME_IN_PAST',
      })
    }

    if (message === 'TOO_FAR') {
      return jsonFail(400, 'That date is too far in the future.', {
        code: 'TOO_FAR',
      })
    }

    if (message.startsWith('STEP:')) {
      return jsonFail(
        400,
        `Start time must be on a ${message.slice(5)}-minute boundary.`,
        { code: 'STEP' },
      )
    }

    if (message.startsWith('WH:')) {
      return jsonFail(
        400,
        message.slice(3) || 'That time is outside working hours.',
        { code: 'OUTSIDE_WORKING_HOURS' },
      )
    }

    console.error('POST /api/bookings/finalize error:', error)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}