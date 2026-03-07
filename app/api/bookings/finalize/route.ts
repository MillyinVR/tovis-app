// app/api/bookings/finalize/route.ts
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type {
  BookingServiceItemType,
  BookingSource,
  BookingStatus,
  NotificationType,
  OpeningStatus,
  ServiceLocationType,
} from '@prisma/client'
import {
  sanitizeTimeZone,
  getZonedParts,
  minutesSinceMidnightInTimeZone,
  isValidIanaTimeZone,
} from '@/lib/timeZone'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { isRecord } from '@/lib/guards'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

const BOOKING_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const satisfies Record<'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED', BookingStatus>

const BOOKING_ITEM_TYPE = {
  BASE: 'BASE',
  ADD_ON: 'ADD_ON',
} as const satisfies Record<'BASE' | 'ADD_ON', BookingServiceItemType>

const BOOKING_SOURCE = {
  AFTERCARE: 'AFTERCARE',
  DISCOVERY: 'DISCOVERY',
  REQUESTED: 'REQUESTED',
} as const satisfies Record<'AFTERCARE' | 'DISCOVERY' | 'REQUESTED', BookingSource>

const OPENING_STATUS = {
  ACTIVE: 'ACTIVE',
  BOOKED: 'BOOKED',
} as const satisfies Record<'ACTIVE' | 'BOOKED', OpeningStatus>

const SERVICE_LOCATION = {
  SALON: 'SALON',
  MOBILE: 'MOBILE',
} as const satisfies Record<'SALON' | 'MOBILE', ServiceLocationType>

const NOTIFICATION_TYPE = {
  BOOKING_REQUEST: 'BOOKING_REQUEST',
  BOOKING_UPDATE: 'BOOKING_UPDATE',
} as const satisfies Record<'BOOKING_REQUEST' | 'BOOKING_UPDATE', NotificationType>

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BUFFER_MINUTES = 180
const MAX_ADVANCE_NOTICE_MINUTES = 24 * 60
const MAX_DAYS_AHEAD = 3650
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES
const DEFAULT_DURATION_MINUTES = 60

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

function throwCode(code: TxnErrorCode): never {
  throw new Error(code)
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(Number(n))
  if (!Number.isFinite(x)) return min
  return Math.min(Math.max(x, min), max)
}

function normalizeSourceLoose(args: {
  sourceRaw: unknown
  mediaId: string | null
  aftercareToken: string | null
}): BookingSource {
  const s = upper(args.sourceRaw)

  if (s === BOOKING_SOURCE.AFTERCARE) return BOOKING_SOURCE.AFTERCARE
  if (s === BOOKING_SOURCE.DISCOVERY) return BOOKING_SOURCE.DISCOVERY
  if (s === BOOKING_SOURCE.REQUESTED) return BOOKING_SOURCE.REQUESTED

  if (s === 'PROFILE') return BOOKING_SOURCE.REQUESTED
  if (s === 'UNKNOWN') return BOOKING_SOURCE.REQUESTED

  if (args.aftercareToken) return BOOKING_SOURCE.AFTERCARE
  if (args.mediaId) return BOOKING_SOURCE.DISCOVERY
  return BOOKING_SOURCE.REQUESTED
}

function normalizeLocationTypeStrict(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === SERVICE_LOCATION.SALON) return SERVICE_LOCATION.SALON
  if (s === SERVICE_LOCATION.MOBILE) return SERVICE_LOCATION.MOBILE
  return null
}

function normalizeStepMinutes(input: unknown, fallback: number) {
  const n = typeof input === 'number' ? input : Number(input)
  const raw = Number.isFinite(n) ? Math.trunc(n) : fallback

  const allowed = new Set([5, 10, 15, 20, 30, 60])
  if (allowed.has(raw)) return raw

  if (raw <= 5) return 5
  if (raw <= 10) return 10
  if (raw <= 15) return 15
  if (raw <= 20) return 20
  if (raw <= 30) return 30
  return 60
}

function ensureWithinWorkingHours(args: {
  scheduledStartUtc: Date
  scheduledEndUtc: Date
  workingHours: unknown
  timeZone: string
}): { ok: true } | { ok: false; error: string } {
  const { scheduledStartUtc, scheduledEndUtc, workingHours, timeZone } = args
  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'

  if (!isRecord(workingHours)) {
    return { ok: false, error: 'This professional has not set working hours yet.' }
  }

  const sParts = getZonedParts(scheduledStartUtc, tz)
  const eParts = getZonedParts(scheduledEndUtc, tz)
  const sameLocalDay =
    sParts.year === eParts.year &&
    sParts.month === eParts.month &&
    sParts.day === eParts.day

  if (!sameLocalDay) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }

  const window = getWorkingWindowForDay(scheduledStartUtc, workingHours, tz)
  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return { ok: false, error: 'This professional has not set working hours yet.' }
    }
    if (window.reason === 'DISABLED') {
      return { ok: false, error: 'That time is outside this professional’s working hours.' }
    }
    return { ok: false, error: 'This professional’s working hours are misconfigured.' }
  }

  const startMin = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMin = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

  if (startMin < window.startMinutes || endMin > window.endMinutes) {
    return { ok: false, error: 'That time is outside this professional’s working hours.' }
  }

  return { ok: true }
}

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
    .slice(0, 25)
}

function hasDuplicates(values: string[]) {
  return new Set(values).size !== values.length
}

function decimalToNumber(v: unknown): number | undefined {
  if (v == null) return undefined

  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined
  }

  if (typeof v === 'object' && v !== null) {
    const maybeToString = (v as { toString?: unknown }).toString
    if (typeof maybeToString === 'function') {
      const n = Number(String(maybeToString.call(v)))
      return Number.isFinite(n) ? n : undefined
    }
  }

  return undefined
}

function decimalFromUnknown(v: unknown): Prisma.Decimal {
  if (v instanceof Prisma.Decimal) return v
  if (typeof v === 'number' && Number.isFinite(v)) return new Prisma.Decimal(String(v))
  if (typeof v === 'string' && v.trim()) return new Prisma.Decimal(v.trim())

  if (v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function') {
    return new Prisma.Decimal(String((v as { toString: () => string }).toString()))
  }

  return new Prisma.Decimal('0')
}

function pickModeDurationMinutes(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}) {
  const raw =
    args.locationType === SERVICE_LOCATION.MOBILE
      ? args.mobileDurationMinutes
      : args.salonDurationMinutes

  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MINUTES
  return clampInt(n, 15, MAX_SLOT_DURATION_MINUTES)
}

function buildAddressSnapshot(formattedAddress: string | null | undefined): Prisma.InputJsonValue | undefined {
  const value = typeof formattedAddress === 'string' ? formattedAddress.trim() : ''
  if (!value) return undefined
  return { formattedAddress: value } satisfies Prisma.InputJsonObject
}

function extractFormattedAddressFromSnapshot(value: Prisma.JsonValue | null | undefined): string | null {
  if (!isRecord(value)) return null
  const raw = value.formattedAddress
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed || null
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

    const addOnIds = pickStringArray(body.addOnIds)
    if (hasDuplicates(addOnIds)) {
      return jsonFail(400, 'One or more add-ons are invalid for this booking.', { code: 'ADDONS_INVALID' })
    }

    const source = normalizeSourceLoose({
      sourceRaw: body.source,
      mediaId,
      aftercareToken,
    })

    const locationType = normalizeLocationTypeStrict(body.locationType)

    if (!locationType) {
      return jsonFail(400, 'Missing locationType.', { code: 'MISSING_LOCATION_TYPE' })
    }

    if (!offeringId) {
      return jsonFail(400, 'Missing offeringId.', { code: 'MISSING_OFFERING' })
    }

    if (!holdId) {
      return jsonFail(409, 'Missing hold. Please pick a slot again.', { code: 'HOLD_MISSING' })
    }

    if (source === BOOKING_SOURCE.DISCOVERY && !mediaId) {
      return jsonFail(400, 'Discovery bookings require a mediaId.', { code: 'MISSING_MEDIA_ID' })
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
      return jsonFail(400, 'Invalid or inactive offering.', { code: 'OFFERING_INACTIVE' })
    }

    if (locationType === SERVICE_LOCATION.SALON && !offering.offersInSalon) {
      return jsonFail(400, 'This service is not offered in-salon.', { code: 'MODE_NOT_SUPPORTED' })
    }

    if (locationType === SERVICE_LOCATION.MOBILE && !offering.offersMobile) {
      return jsonFail(400, 'This service is not offered as mobile.', { code: 'MODE_NOT_SUPPORTED' })
    }

    const priceStartingAt =
      locationType === SERVICE_LOCATION.MOBILE
        ? offering.mobilePriceStartingAt
        : offering.salonPriceStartingAt

    const baseDurationMinutes = pickModeDurationMinutes({
      locationType,
      salonDurationMinutes: offering.salonDurationMinutes,
      mobileDurationMinutes: offering.mobileDurationMinutes,
    })

    if (priceStartingAt == null) {
      return jsonFail(
        400,
        `Pricing is not set for ${locationType === SERVICE_LOCATION.MOBILE ? 'mobile' : 'salon'} bookings.`,
        { code: 'PRICING_NOT_SET' },
      )
    }

    if (!Number.isFinite(baseDurationMinutes) || baseDurationMinutes <= 0) {
      return jsonFail(400, 'Offering duration is invalid for this booking type.', { code: 'INVALID_DURATION' })
    }

    const now = new Date()
    const autoAccept = Boolean(offering.professional?.autoAcceptBookings)
    const initialStatus = autoAccept ? BOOKING_STATUS.ACCEPTED : BOOKING_STATUS.PENDING

    let rebookOfBookingIdForCreate: string | null = null

    if (source === BOOKING_SOURCE.AFTERCARE) {
      if (!aftercareToken) {
        return jsonFail(400, 'Missing aftercare token.', { code: 'AFTERCARE_TOKEN_MISSING' })
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
        return jsonFail(400, 'Invalid aftercare token.', { code: 'AFTERCARE_TOKEN_INVALID' })
      }

      const original = aftercare.booking

      if (original.status !== BOOKING_STATUS.COMPLETED) {
        return jsonFail(409, 'Only COMPLETED bookings can be rebooked.', { code: 'AFTERCARE_NOT_COMPLETED' })
      }

      if (original.clientId !== clientId) {
        return jsonFail(403, 'Aftercare link does not match this client.', { code: 'AFTERCARE_CLIENT_MISMATCH' })
      }

      const matchesOffering =
        (original.offeringId && original.offeringId === offering.id) ||
        (original.professionalId === offering.professionalId && original.serviceId === offering.serviceId)

      if (!matchesOffering) {
        return jsonFail(403, 'Aftercare link does not match this offering.', { code: 'AFTERCARE_OFFERING_MISMATCH' })
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

      const loc = await tx.professionalLocation.findFirst({
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

      if (!loc) throwCode('LOCATION_NOT_FOUND')

      const tzResult = await resolveApptTimeZone({
        holdLocationTimeZone: hold.locationTimeZone,
        location: { id: loc.id, timeZone: loc.timeZone },
        professionalId: offering.professionalId,
        fallback: 'UTC',
        requireValid: true,
      })

      if (!tzResult.ok) throwCode('TIMEZONE_REQUIRED')

      const apptTz = sanitizeTimeZone(tzResult.timeZone, 'UTC') || 'UTC'
      if (!isValidIanaTimeZone(apptTz)) throwCode('TIMEZONE_REQUIRED')

      const bufferMinutes = clampInt(Number(loc.bufferMinutes ?? 0), 0, MAX_BUFFER_MINUTES)
      const stepMinutes = normalizeStepMinutes(loc.stepMinutes, 15)
      const advanceNoticeMinutes = clampInt(
        Number(loc.advanceNoticeMinutes ?? 15),
        0,
        MAX_ADVANCE_NOTICE_MINUTES,
      )
      const maxDaysAhead = clampInt(Number(loc.maxDaysAhead ?? 365), 1, MAX_DAYS_AHEAD)

      const requestedStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (!Number.isFinite(requestedStart.getTime())) throwCode('TIME_IN_PAST')

      if (requestedStart.getTime() < now.getTime() + advanceNoticeMinutes * 60_000) {
        throwCode('TIME_IN_PAST')
      }

      if (requestedStart.getTime() > now.getTime() + maxDaysAhead * 24 * 60 * 60_000) {
        throwCode('TOO_FAR')
      }

      const startMin = minutesSinceMidnightInTimeZone(requestedStart, apptTz)
      if (startMin % stepMinutes !== 0) {
        throw new Error(`STEP:${stepMinutes}`)
      }

      if (openingId) {
        const activeOpening = await tx.lastMinuteOpening.findFirst({
          where: {
            id: openingId,
            status: OPENING_STATUS.ACTIVE,
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
        if (activeOpening.professionalId !== offering.professionalId) throwCode('OPENING_NOT_AVAILABLE')
        if (activeOpening.offeringId && activeOpening.offeringId !== offering.id) {
          throwCode('OPENING_NOT_AVAILABLE')
        }
        if (activeOpening.serviceId && activeOpening.serviceId !== offering.serviceId) {
          throwCode('OPENING_NOT_AVAILABLE')
        }
        if (normalizeToMinute(new Date(activeOpening.startAt)).getTime() !== requestedStart.getTime()) {
          throwCode('OPENING_NOT_AVAILABLE')
        }

        const updated = await tx.lastMinuteOpening.updateMany({
          where: {
            id: openingId,
            status: OPENING_STATUS.ACTIVE,
          },
          data: {
            status: OPENING_STATUS.BOOKED,
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
        const svc = row.addOnService
        const proOff = addOnOfferingByServiceId.get(svc.id) ?? null

        const durationMinutesSnapshot = pickModeDurationMinutes({
          locationType,
          salonDurationMinutes:
            row.durationOverrideMinutes ??
            proOff?.salonDurationMinutes ??
            svc.defaultDurationMinutes ??
            null,
          mobileDurationMinutes:
            row.durationOverrideMinutes ??
            proOff?.mobileDurationMinutes ??
            svc.defaultDurationMinutes ??
            null,
        })

        const priceRaw =
          row.priceOverride ??
          (locationType === SERVICE_LOCATION.MOBILE
            ? proOff?.mobilePriceStartingAt
            : proOff?.salonPriceStartingAt) ??
          svc.minPrice

        return {
          offeringAddOnId: row.id,
          serviceId: svc.id,
          durationMinutesSnapshot,
          priceSnapshot: decimalFromUnknown(priceRaw),
          sortOrder: row.sortOrder ?? 0,
        }
      })

      for (const addOn of resolvedAddOns) {
        if (!Number.isFinite(addOn.durationMinutesSnapshot) || addOn.durationMinutesSnapshot <= 0) {
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

      const requestedEnd = addMinutes(requestedStart, totalDurationMinutes + bufferMinutes)

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })

      if (!whCheck.ok) {
        throw new Error(`WH:${whCheck.error}`)
      }

      const blockConflict = await tx.calendarBlock.findFirst({
        where: {
          professionalId: offering.professionalId,
          startsAt: { lt: requestedEnd },
          endsAt: { gt: requestedStart },
          OR: [{ locationId: loc.id }, { locationId: null }],
        },
        select: { id: true },
      })

      if (blockConflict) throwCode('BLOCKED')

      const earliestStart = addMinutes(requestedStart, -MAX_OTHER_OVERLAP_MINUTES)

      const existingBookings = await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          scheduledFor: { gte: earliestStart, lt: requestedEnd },
          status: { not: BOOKING_STATUS.CANCELLED },
        },
        select: {
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 2000,
      })

      const hasBookingConflict = existingBookings.some((row) => {
        const otherStart = normalizeToMinute(new Date(row.scheduledFor))
        const otherDurationRaw = Number(row.totalDurationMinutes ?? 0)
        const otherDuration =
          Number.isFinite(otherDurationRaw) && otherDurationRaw > 0
            ? clampInt(otherDurationRaw, 15, MAX_SLOT_DURATION_MINUTES)
            : DEFAULT_DURATION_MINUTES
        const otherBuffer = clampInt(Number(row.bufferMinutes ?? 0), 0, MAX_BUFFER_MINUTES)
        const otherEnd = addMinutes(otherStart, otherDuration + otherBuffer)

        return overlaps(otherStart, otherEnd, requestedStart, requestedEnd)
      })

      if (hasBookingConflict) throwCode('TIME_NOT_AVAILABLE')

      const otherHolds = await tx.bookingHold.findMany({
        where: {
          professionalId: offering.professionalId,
          expiresAt: { gt: now },
          scheduledFor: { gte: earliestStart, lt: requestedEnd },
        },
        select: {
          id: true,
          scheduledFor: true,
          offeringId: true,
          locationId: true,
          locationType: true,
        },
        take: 2000,
      })

      if (otherHolds.length) {
        const holdOfferingIds = Array.from(new Set(otherHolds.map((row) => row.offeringId)))

        const holdOfferings = holdOfferingIds.length
          ? await tx.professionalServiceOffering.findMany({
              where: { id: { in: holdOfferingIds } },
              select: {
                id: true,
                salonDurationMinutes: true,
                mobileDurationMinutes: true,
              },
              take: 2000,
            })
          : []

        const holdOfferingById = new Map(holdOfferings.map((row) => [row.id, row]))

        const holdLocationIds = Array.from(
          new Set(
            otherHolds
              .map((row) => row.locationId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
          ),
        )

        const holdLocations = holdLocationIds.length
          ? await tx.professionalLocation.findMany({
              where: { id: { in: holdLocationIds } },
              select: {
                id: true,
                bufferMinutes: true,
              },
              take: 2000,
            })
          : []

        const holdBufferByLocationId = new Map(
          holdLocations.map((row) => [
            row.id,
            clampInt(Number(row.bufferMinutes ?? 0), 0, MAX_BUFFER_MINUTES),
          ]),
        )

        const hasHoldConflict = otherHolds.some((row) => {
          if (row.id === hold.id) return false

          const holdOffering = holdOfferingById.get(row.offeringId)
          const holdDuration = pickModeDurationMinutes({
            locationType: row.locationType,
            salonDurationMinutes: holdOffering?.salonDurationMinutes ?? null,
            mobileDurationMinutes: holdOffering?.mobileDurationMinutes ?? null,
          })

          const otherStart = normalizeToMinute(new Date(row.scheduledFor))
          const otherBuffer = holdBufferByLocationId.get(row.locationId ?? '') ?? bufferMinutes
          const otherEnd = addMinutes(otherStart, holdDuration + otherBuffer)

          return overlaps(otherStart, otherEnd, requestedStart, requestedEnd)
        })

        if (hasHoldConflict) throwCode('TIME_NOT_AVAILABLE')
      }

      const formattedAddressFromHold = extractFormattedAddressFromSnapshot(hold.locationAddressSnapshot)
      const addressSnapshot = buildAddressSnapshot(formattedAddressFromHold ?? loc.formattedAddress)

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

            locationId: loc.id,
            locationTimeZone: apptTz,
            locationAddressSnapshot: addressSnapshot,
            locationLatSnapshot: hold.locationLatSnapshot ?? decimalToNumber(loc.lat),
            locationLngSnapshot: hold.locationLngSnapshot ?? decimalToNumber(loc.lng),
          },
          select: {
            id: true,
            status: true,
            scheduledFor: true,
            professionalId: true,
          },
        })
      } catch (e: unknown) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throwCode('TIME_NOT_AVAILABLE')
        }
        throw e
      }

      const baseItem = await tx.bookingServiceItem.create({
        data: {
          bookingId: created.id,
          serviceId: offering.serviceId,
          offeringId: offering.id,
          itemType: BOOKING_ITEM_TYPE.BASE,
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
            itemType: BOOKING_ITEM_TYPE.ADD_ON,
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

      await tx.bookingHold.delete({ where: { id: hold.id } })

      return created
    })

    const notifType =
      booking.status === BOOKING_STATUS.PENDING
        ? NOTIFICATION_TYPE.BOOKING_REQUEST
        : NOTIFICATION_TYPE.BOOKING_UPDATE

    await createProNotification({
      professionalId: booking.professionalId,
      type: notifType,
      title:
        notifType === NOTIFICATION_TYPE.BOOKING_REQUEST
          ? 'New booking request'
          : 'New booking confirmed',
      body: '',
      href: `/pro/bookings/${booking.id}`,
      actorUserId: user.id,
      bookingId: booking.id,
      dedupeKey: `PRO_NOTIF:${String(notifType)}:${booking.id}`,
    })

    return jsonOk({ booking }, 201)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''

    if (msg === 'ADDONS_INVALID') {
      return jsonFail(400, 'One or more add-ons are invalid for this booking.', { code: 'ADDONS_INVALID' })
    }
    if (msg === 'TIMEZONE_REQUIRED') {
      return jsonFail(400, 'This professional must set a valid timezone before taking bookings.', { code: 'TIMEZONE_REQUIRED' })
    }
    if (msg === 'OPENING_NOT_AVAILABLE') {
      return jsonFail(409, 'That opening was just taken. Please pick another slot.', { code: 'OPENING_NOT_AVAILABLE' })
    }
    if (msg === 'TIME_NOT_AVAILABLE') {
      return jsonFail(409, 'That time is no longer available. Please select a different slot.', { code: 'TIME_NOT_AVAILABLE' })
    }
    if (msg === 'BLOCKED') {
      return jsonFail(409, 'That time is blocked. Please select a different slot.', { code: 'BLOCKED' })
    }
    if (msg === 'HOLD_NOT_FOUND') {
      return jsonFail(409, 'Hold not found. Please pick a slot again.', { code: 'HOLD_NOT_FOUND' })
    }
    if (msg === 'HOLD_EXPIRED') {
      return jsonFail(409, 'Hold expired. Please pick a slot again.', { code: 'HOLD_EXPIRED' })
    }
    if (msg === 'HOLD_MISMATCH') {
      return jsonFail(409, 'Hold mismatch. Please pick a slot again.', { code: 'HOLD_MISMATCH' })
    }
    if (msg === 'HOLD_MISSING_LOCATION') {
      return jsonFail(409, 'Hold is missing location info. Please pick a slot again.', { code: 'HOLD_MISSING_LOCATION' })
    }
    if (msg === 'LOCATION_NOT_FOUND') {
      return jsonFail(409, 'This location is no longer available. Please pick another slot.', { code: 'LOCATION_NOT_FOUND' })
    }
    if (msg === 'TIME_IN_PAST') {
      return jsonFail(400, 'Please select a future time.', { code: 'TIME_IN_PAST' })
    }
    if (msg === 'TOO_FAR') {
      return jsonFail(400, 'That date is too far in the future.', { code: 'TOO_FAR' })
    }
    if (msg.startsWith('STEP:')) {
      return jsonFail(400, `Start time must be on a ${msg.slice(5)}-minute boundary.`, { code: 'STEP' })
    }
    if (msg.startsWith('WH:')) {
      return jsonFail(400, msg.slice(3) || 'That time is outside working hours.', { code: 'OUTSIDE_WORKING_HOURS' })
    }

    console.error('POST /api/bookings/finalize error:', e)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}