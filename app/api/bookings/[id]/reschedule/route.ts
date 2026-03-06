// app/api/bookings/[id]/reschedule/route.ts
import { prisma } from '@/lib/prisma'
import { BookingStatus, Prisma, type ServiceLocationType } from '@prisma/client'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import {
  sanitizeTimeZone,
  DEFAULT_TIME_ZONE,
  getZonedParts,
  minutesSinceMidnightInTimeZone,
} from '@/lib/timeZone'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { isRecord } from '@/lib/guards'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }
type LocationType = Extract<ServiceLocationType, 'SALON' | 'MOBILE'>

const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES

function isLocationType(x: unknown): x is LocationType {
  return x === 'SALON' || x === 'MOBILE'
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(Number(n))
  if (!Number.isFinite(x)) return min
  return Math.max(min, Math.min(max, x))
}

function decimalToNumber(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    const n = (v as { toNumber: () => number }).toNumber()
    return Number.isFinite(n) ? n : undefined
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

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
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

    const requestedLocationTypeRaw = pickString(body.locationType)
    if (requestedLocationTypeRaw && !isLocationType(requestedLocationTypeRaw)) {
      return jsonFail(400, 'Missing or invalid locationType.')
    }
    const requestedLocationType = requestedLocationTypeRaw ?? null

    const now = new Date()

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        startedAt: true,
        finishedAt: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        locationId: true,
        locationTimeZone: true,
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    if (booking.status === BookingStatus.COMPLETED || booking.status === BookingStatus.CANCELLED) {
      return jsonFail(409, 'This booking cannot be rescheduled.')
    }
    if (booking.startedAt || booking.finishedAt) {
      return jsonFail(409, 'This booking has started and cannot be rescheduled.')
    }

    const rawDuration = Number(booking.totalDurationMinutes ?? 0)
    if (!Number.isFinite(rawDuration) || rawDuration < 15 || rawDuration > MAX_SLOT_DURATION_MINUTES) {
      return jsonFail(409, 'This booking has an invalid duration and cannot be rescheduled.')
    }
    const totalDurationMinutes = rawDuration

    const result = await prisma.$transaction(async (tx) => {
      const hold = await tx.bookingHold.findUnique({
        where: { id: holdId },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          scheduledFor: true,
          expiresAt: true,
          locationType: true,
          locationId: true,
        },
      })

      if (!hold) return { ok: false as const, status: 404, error: 'Hold not found. Please pick a new time.' }
      if (!hold.clientId || hold.clientId !== clientId) {
        return { ok: false as const, status: 403, error: 'Hold does not belong to you.' }
      }
      if (hold.expiresAt.getTime() <= now.getTime()) {
        return { ok: false as const, status: 409, error: 'Hold expired. Please pick a new time.' }
      }
      if (hold.professionalId !== booking.professionalId) {
        return { ok: false as const, status: 409, error: 'Hold is for a different professional.' }
      }
      if (requestedLocationType && hold.locationType !== requestedLocationType) {
        return { ok: false as const, status: 409, error: 'Hold locationType does not match.' }
      }
      if (!hold.locationId) {
        return { ok: false as const, status: 409, error: 'Hold is missing location info. Please pick a new slot.' }
      }

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

      if (!loc) {
        return { ok: false as const, status: 409, error: 'This location is no longer available.' }
      }

      const tzRes = await resolveApptTimeZone({
        location: { id: loc.id, timeZone: loc.timeZone },
        professionalId: booking.professionalId,
        fallback: DEFAULT_TIME_ZONE,
        requireValid: true,
      })
      if (!tzRes.ok) {
        return { ok: false as const, status: 409, error: 'This location is missing a valid timezone.' }
      }

      const apptTz = tzRes.timeZone
      const locationBufferMinutes = clampInt(Number(loc.bufferMinutes ?? 0) || 0, 0, MAX_BUFFER_MINUTES)
      const finalBufferMinutes = clampInt(
        Number(loc.bufferMinutes ?? booking.bufferMinutes ?? 0) || 0,
        0,
        MAX_BUFFER_MINUTES,
      )
      const stepMinutes = clampInt(Number(loc.stepMinutes ?? 15) || 15, 5, 60)
      const advanceNoticeMinutes = clampInt(Number(loc.advanceNoticeMinutes ?? 15) || 15, 0, 24 * 60)
      const maxDaysAhead = clampInt(Number(loc.maxDaysAhead ?? 365) || 365, 1, 3650)

      const newStart = normalizeToMinute(new Date(hold.scheduledFor))
      if (!Number.isFinite(newStart.getTime())) {
        return { ok: false as const, status: 400, error: 'Hold time is invalid. Please pick a new slot.' }
      }

      if (newStart.getTime() < now.getTime() + advanceNoticeMinutes * 60_000) {
        return { ok: false as const, status: 400, error: 'Please select a future time.' }
      }

      if (newStart.getTime() > now.getTime() + maxDaysAhead * 24 * 60 * 60_000) {
        return { ok: false as const, status: 400, error: 'That date is too far in the future.' }
      }

      const startMin = minutesSinceMidnightInTimeZone(newStart, apptTz)
      if (startMin % stepMinutes !== 0) {
        return {
          ok: false as const,
          status: 400,
          error: `Start time must be on a ${stepMinutes}-minute boundary.`,
        }
      }

      const newEnd = addMinutes(newStart, totalDurationMinutes + finalBufferMinutes)

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: newStart,
        scheduledEndUtc: newEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) {
        return { ok: false as const, status: 400, error: whCheck.error }
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

      if (blockConflict) {
        return {
          ok: false as const,
          status: 409,
          error: 'That time is blocked. Please choose a new slot.',
        }
      }

      const earliestStart = addMinutes(newStart, -MAX_OTHER_OVERLAP_MINUTES)

      const otherBookings = await tx.booking.findMany({
        where: {
          professionalId: booking.professionalId,
          locationId: loc.id,
          id: { not: booking.id },
          scheduledFor: { gte: earliestStart, lt: newEnd },
          NOT: { status: BookingStatus.CANCELLED },
        },
        select: {
          scheduledFor: true,
          totalDurationMinutes: true,
          bufferMinutes: true,
        },
        take: 2000,
      })

      const hasBookingConflict = otherBookings.some((b) => {
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bDurRaw = Number(b.totalDurationMinutes ?? 0)
        const bDur =
          Number.isFinite(bDurRaw) && bDurRaw > 0
            ? clampInt(bDurRaw, 15, MAX_SLOT_DURATION_MINUTES)
            : 60

        const bBuf = clampInt(Number(b.bufferMinutes ?? 0) || 0, 0, MAX_BUFFER_MINUTES)
        const bEnd = addMinutes(bStart, bDur + bBuf)

        return overlaps(bStart, bEnd, newStart, newEnd)
      })

      if (hasBookingConflict) {
        return {
          ok: false as const,
          status: 409,
          error: 'That time is no longer available. Please choose a new slot.',
        }
      }

      const otherHolds = await tx.bookingHold.findMany({
        where: {
          professionalId: booking.professionalId,
          locationId: loc.id,
          expiresAt: { gt: now },
          scheduledFor: { gte: earliestStart, lt: newEnd },
        },
        select: {
          id: true,
          scheduledFor: true,
          offeringId: true,
          locationType: true,
        },
        take: 2000,
      })

      if (otherHolds.length) {
        const offeringIds = Array.from(new Set(otherHolds.map((h) => h.offeringId))).slice(0, 2000)

        const offerRows = await tx.professionalServiceOffering.findMany({
          where: { id: { in: offeringIds } },
          select: {
            id: true,
            salonDurationMinutes: true,
            mobileDurationMinutes: true,
          },
          take: 2000,
        })

        const offerById = new Map(offerRows.map((row) => [row.id, row]))

        const hasHoldConflict = otherHolds.some((h) => {
          if (h.id === hold.id) return false

          const offering = offerById.get(h.offeringId)
          const durRaw =
            h.locationType === 'MOBILE'
              ? offering?.mobileDurationMinutes
              : offering?.salonDurationMinutes

          const base = Number(durRaw ?? 0)
          const holdDuration =
            Number.isFinite(base) && base > 0
              ? clampInt(base, 15, MAX_SLOT_DURATION_MINUTES)
              : 60

          const hStart = normalizeToMinute(new Date(h.scheduledFor))
          const hEnd = addMinutes(hStart, holdDuration + locationBufferMinutes)

          return overlaps(hStart, hEnd, newStart, newEnd)
        })

        if (hasHoldConflict) {
          return {
            ok: false as const,
            status: 409,
            error: 'That time is no longer available. Please choose a new slot.',
          }
        }
      }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          scheduledFor: newStart,
          locationType: hold.locationType,
          bufferMinutes: finalBufferMinutes,
          locationId: loc.id,
          locationTimeZone: apptTz,
          locationAddressSnapshot:
            typeof loc.formattedAddress === 'string' && loc.formattedAddress.trim()
              ? ({ formattedAddress: loc.formattedAddress.trim() } satisfies Prisma.InputJsonObject)
              : undefined,
          locationLatSnapshot: decimalToNumber(loc.lat),
          locationLngSnapshot: decimalToNumber(loc.lng),
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

      return { ok: true as const, updated }
    })

    if (!result.ok) {
      return jsonFail(result.status, result.error)
    }

    return jsonOk(
      {
        booking: {
          id: result.updated.id,
          status: result.updated.status,
          scheduledFor: new Date(result.updated.scheduledFor).toISOString(),
          locationType: result.updated.locationType,
          bufferMinutes: result.updated.bufferMinutes ?? 0,
          totalDurationMinutes: result.updated.totalDurationMinutes ?? 0,
          locationTimeZone: result.updated.locationTimeZone ?? null,
        },
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/bookings/[id]/reschedule error', e)
    return jsonFail(500, 'Failed to reschedule booking.')
  }
}