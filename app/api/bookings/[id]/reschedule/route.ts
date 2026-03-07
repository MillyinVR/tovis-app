// app/api/bookings/[id]/reschedule/route.ts
import { prisma } from '@/lib/prisma'
import { BookingStatus, Prisma, ServiceLocationType } from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import {
  sanitizeTimeZone,
  DEFAULT_TIME_ZONE,
  getZonedParts,
  minutesSinceMidnightInTimeZone,
  isValidIanaTimeZone,
} from '@/lib/timeZone'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { isRecord } from '@/lib/guards'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES
const MAX_ADVANCE_NOTICE_MINUTES = 24 * 60
const MAX_DAYS_AHEAD = 3650
const DEFAULT_DURATION_MINUTES = 60

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

function normalizeLocationTypeStrict(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return ServiceLocationType.SALON
  if (s === 'MOBILE') return ServiceLocationType.MOBILE
  return null
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(Number(n))
  if (!Number.isFinite(x)) return min
  return Math.max(min, Math.min(max, x))
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

function decimalToNumber(v: unknown): number | undefined {
  if (v == null) return undefined

  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined
  }

  if (typeof v === 'object' && v !== null) {
    const maybeToNumber = (v as { toNumber?: unknown }).toNumber
    if (typeof maybeToNumber === 'function') {
      const n = maybeToNumber.call(v) as number
      return Number.isFinite(n) ? n : undefined
    }

    const maybeToString = (v as { toString?: unknown }).toString
    if (typeof maybeToString === 'function') {
      const n = Number(String(maybeToString.call(v)))
      return Number.isFinite(n) ? n : undefined
    }
  }

  return undefined
}

function ensureWithinWorkingHours(args: {
  scheduledStartUtc: Date
  scheduledEndUtc: Date
  workingHours: unknown
  timeZone: string
}): { ok: true } | { ok: false; error: string } {
  const { scheduledStartUtc, scheduledEndUtc, workingHours, timeZone } = args

  if (!isRecord(workingHours)) {
    return { ok: false, error: 'This professional has not set working hours yet.' }
  }

  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)

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

function pickHoldDurationMinutes(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}) {
  const raw =
    args.locationType === ServiceLocationType.MOBILE
      ? args.mobileDurationMinutes
      : args.salonDurationMinutes

  const n = Number(raw ?? 0)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MINUTES
  return clampInt(n, 15, MAX_SLOT_DURATION_MINUTES)
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const clientId = auth.clientId

    const resolvedParams = await Promise.resolve(params)
    const bookingId = pickString(resolvedParams.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const holdId = pickString(body.holdId)
    if (!holdId) return jsonFail(400, 'Missing holdId.')

    const hasLocationType = Object.prototype.hasOwnProperty.call(body, 'locationType')
    const requestedLocationType = hasLocationType ? normalizeLocationTypeStrict(body.locationType) : null
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

      if (booking.status === BookingStatus.COMPLETED || booking.status === BookingStatus.CANCELLED) {
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
      if (!Number.isFinite(rawDuration) || rawDuration < 15 || rawDuration > MAX_SLOT_DURATION_MINUTES) {
        throwCode('INVALID_DURATION')
      }
      const totalDurationMinutes = rawDuration

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

      const loc = await tx.professionalLocation.findFirst({
        where: {
          id: hold.locationId,
          professionalId: booking.professionalId,
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

      const tzRes = await resolveApptTimeZone({
        holdLocationTimeZone: hold.locationTimeZone,
        location: { id: loc.id, timeZone: loc.timeZone },
        professionalId: booking.professionalId,
        fallback: DEFAULT_TIME_ZONE,
        requireValid: true,
      })

      if (!tzRes.ok) throwCode('TIMEZONE_REQUIRED')

      const apptTz = sanitizeTimeZone(tzRes.timeZone, DEFAULT_TIME_ZONE)
      if (!isValidIanaTimeZone(apptTz)) throwCode('TIMEZONE_REQUIRED')

      const finalBufferMinutes = clampInt(Number(loc.bufferMinutes ?? 0), 0, MAX_BUFFER_MINUTES)
      const stepMinutes = normalizeStepMinutes(loc.stepMinutes, 15)
      const advanceNoticeMinutes = clampInt(
        Number(loc.advanceNoticeMinutes ?? 15),
        0,
        MAX_ADVANCE_NOTICE_MINUTES,
      )
      const maxDaysAhead = clampInt(Number(loc.maxDaysAhead ?? 365), 1, MAX_DAYS_AHEAD)

      const newStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (!Number.isFinite(newStart.getTime())) throwCode('HOLD_TIME_INVALID')

      if (newStart.getTime() < now.getTime() + advanceNoticeMinutes * 60_000) {
        throwCode('TIME_IN_PAST')
      }

      if (newStart.getTime() > now.getTime() + maxDaysAhead * 24 * 60 * 60_000) {
        throwCode('TOO_FAR')
      }

      const startMin = minutesSinceMidnightInTimeZone(newStart, apptTz)
      if (startMin % stepMinutes !== 0) {
        throw new Error(`STEP:${stepMinutes}`)
      }

      const newEnd = addMinutes(newStart, totalDurationMinutes + finalBufferMinutes)

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: newStart,
        scheduledEndUtc: newEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })

      if (!whCheck.ok) {
        throw new Error(`WH:${whCheck.error}`)
      }

      const blockConflict = await tx.calendarBlock.findFirst({
        where: {
          professionalId: booking.professionalId,
          startsAt: { lt: newEnd },
          endsAt: { gt: newStart },
          OR: [{ locationId: loc.id }, { locationId: null }],
        },
        select: { id: true },
      })

      if (blockConflict) throwCode('BLOCKED')

      const earliestStart = addMinutes(newStart, -MAX_OTHER_OVERLAP_MINUTES)

      const otherBookings = await tx.booking.findMany({
        where: {
          professionalId: booking.professionalId,
          id: { not: booking.id },
          scheduledFor: { gte: earliestStart, lt: newEnd },
          status: { not: BookingStatus.CANCELLED },
        },
        select: {
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 2000,
      })

      const hasBookingConflict = otherBookings.some((row) => {
        const otherStart = normalizeToMinute(new Date(row.scheduledFor))
        const otherDurationRaw = Number(row.totalDurationMinutes ?? 0)
        const otherDuration =
          Number.isFinite(otherDurationRaw) && otherDurationRaw > 0
            ? clampInt(otherDurationRaw, 15, MAX_SLOT_DURATION_MINUTES)
            : DEFAULT_DURATION_MINUTES
        const otherBuffer = clampInt(Number(row.bufferMinutes ?? 0), 0, MAX_BUFFER_MINUTES)
        const otherEnd = addMinutes(otherStart, otherDuration + otherBuffer)

        return overlaps(otherStart, otherEnd, newStart, newEnd)
      })

      if (hasBookingConflict) throwCode('TIME_NOT_AVAILABLE')

      const otherHolds = await tx.bookingHold.findMany({
        where: {
          professionalId: booking.professionalId,
          expiresAt: { gt: now },
          scheduledFor: { gte: earliestStart, lt: newEnd },
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
        const otherHoldOfferingIds = Array.from(new Set(otherHolds.map((row) => row.offeringId)))

        const holdOfferings = otherHoldOfferingIds.length
          ? await tx.professionalServiceOffering.findMany({
              where: { id: { in: otherHoldOfferingIds } },
              select: {
                id: true,
                salonDurationMinutes: true,
                mobileDurationMinutes: true,
              },
              take: 2000,
            })
          : []

        const holdOfferingById = new Map(holdOfferings.map((row) => [row.id, row]))

        const otherHoldLocationIds = Array.from(
          new Set(
            otherHolds
              .map((row) => row.locationId)
              .filter((value): value is string => typeof value === 'string' && value.length > 0),
          ),
        )

        const holdLocations = otherHoldLocationIds.length
          ? await tx.professionalLocation.findMany({
              where: { id: { in: otherHoldLocationIds } },
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
          const otherDuration = pickHoldDurationMinutes({
            locationType: row.locationType,
            salonDurationMinutes: holdOffering?.salonDurationMinutes ?? null,
            mobileDurationMinutes: holdOffering?.mobileDurationMinutes ?? null,
          })

          const otherStart = normalizeToMinute(new Date(row.scheduledFor))
          const otherBuffer = holdBufferByLocationId.get(row.locationId ?? '') ?? finalBufferMinutes
          const otherEnd = addMinutes(otherStart, otherDuration + otherBuffer)

          return overlaps(otherStart, otherEnd, newStart, newEnd)
        })

        if (hasHoldConflict) throwCode('TIME_NOT_AVAILABLE')
      }

      const formattedAddressFromHold = extractFormattedAddressFromSnapshot(hold.locationAddressSnapshot)
      const locationAddressSnapshot = buildAddressSnapshot(formattedAddressFromHold ?? loc.formattedAddress)

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          scheduledFor: newStart,
          locationType: hold.locationType,
          bufferMinutes: finalBufferMinutes,
          locationId: loc.id,
          locationTimeZone: apptTz,
          locationAddressSnapshot,
          locationLatSnapshot: hold.locationLatSnapshot ?? decimalToNumber(loc.lat),
          locationLngSnapshot: hold.locationLngSnapshot ?? decimalToNumber(loc.lng),
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

      await tx.bookingHold.delete({ where: { id: hold.id } })

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
  } catch (e) {
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