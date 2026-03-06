// app/api/holds/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma, type ServiceLocationType, BookingStatus } from '@prisma/client'
import { pickBookableLocation } from '@/lib/booking/pickLocation'
import { getZonedParts, minutesSinceMidnightInTimeZone, sanitizeTimeZone, zonedTimeToUtc } from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, requireClient, upper } from '@/app/api/_utils'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'
import { isRecord } from '@/lib/guards'
export const dynamic = 'force-dynamic'

/**
 * How long a client "hold" lasts before expiring.
 * Keep short to reduce dead-time on the calendar.
 */
const HOLD_MINUTES = 10

type CreateHoldBody = {
  offeringId?: unknown
  scheduledFor?: unknown // UTC ISO
  locationType?: unknown
  locationId?: unknown
}

function isValidDate(d: Date) {
  return d instanceof Date && Number.isFinite(d.getTime())
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000)
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function normalizeToMinute(d: Date) {
  const x = new Date(d)
  x.setSeconds(0, 0)
  return x
}

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = upper(v)
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n)
  return Math.min(Math.max(x, min), max)
}

function normalizeStepMinutes(input: unknown, fallback: number) {
  const n = typeof input === 'number' ? input : Number(input)
  const raw = Number.isFinite(n) ? Math.trunc(n) : fallback

  // keep aligned with your calendar UI expectations
  const allowed = new Set([5, 10, 15, 20, 30, 60])
  if (allowed.has(raw)) return raw

  if (raw <= 5) return 5
  if (raw <= 10) return 10
  if (raw <= 15) return 15
  if (raw <= 20) return 20
  if (raw <= 30) return 30
  return 60
}

function pickDurationMinutes(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
}) {
  const raw = args.locationType === 'MOBILE' ? args.mobileDurationMinutes : args.salonDurationMinutes
  const n = Number(raw ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 60
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

  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'

  const sParts = getZonedParts(scheduledStartUtc, tz)
  const eParts = getZonedParts(scheduledEndUtc, tz)
  const sameLocalDay = sParts.year === eParts.year && sParts.month === eParts.month && sParts.day === eParts.day
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


/**
 * Month-boundary-safe YMD +1 (UTC noon to avoid DST edge weirdness)
 */
function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/**
 * Day window in UTC for the LOCAL day (in appt tz) that contains instantUtc.
 */
function getDayWindowUtcFromUtcInstant(args: { instantUtc: Date; timeZone: string }) {
  const tz = sanitizeTimeZone(args.timeZone, 'UTC') || 'UTC'
  const parts = getZonedParts(args.instantUtc, tz)

  const dayStartUtc = zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  const next = addDaysToYMD(parts.year, parts.month, parts.day, 1)
  const dayEndExclusiveUtc = zonedTimeToUtc({
    year: next.year,
    month: next.month,
    day: next.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  return { dayStartUtc, dayEndExclusiveUtc }
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

export async function POST(req: NextRequest) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const body = (await req.json().catch(() => ({}))) as CreateHoldBody

    const offeringId = pickString(body.offeringId)
    const requestedLocationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const scheduledForRaw = typeof body.scheduledFor === 'string' ? body.scheduledFor.trim() : null

    if (!offeringId || !scheduledForRaw || !locationType) {
      return jsonFail(400, 'Missing offeringId, scheduledFor, or locationType.')
    }

    const scheduledForParsed = new Date(scheduledForRaw)
    if (!isValidDate(scheduledForParsed)) return jsonFail(400, 'Invalid scheduledFor.')

    const now = new Date()
    const requestedStart = normalizeToMinute(scheduledForParsed)

    // basic sanity: not in the past (real lead-time comes from location below)
    if (requestedStart.getTime() < now.getTime() + 60_000) {
      return jsonFail(400, 'Please select a future time.')
    }

    const result = await prisma.$transaction(async (tx) => {
      const offering = await tx.professionalServiceOffering.findUnique({
        where: { id: offeringId },
        select: {
          id: true,
          isActive: true,
          professionalId: true,
          offersInSalon: true,
          offersMobile: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
        },
      })

      if (!offering || !offering.isActive) {
        return { ok: false as const, status: 404, error: 'Offering not found.' }
      }

      // Ensure offering supports requested booking mode
      if (locationType === 'SALON' && !offering.offersInSalon) {
        return { ok: false as const, status: 400, error: 'This service is not available in-salon.' }
      }
      if (locationType === 'MOBILE' && !offering.offersMobile) {
        return { ok: false as const, status: 400, error: 'This service is not available for mobile.' }
      }

      const loc = await pickBookableLocation({
        professionalId: offering.professionalId,
        requestedLocationId,
        locationType,
      })

      if (!loc) {
        return { ok: false as const, status: 404, error: 'Location not found or not bookable.' }
      }

      const tzRes = await resolveApptTimeZone({
        location: { id: loc.id, timeZone: loc.timeZone },
        professionalId: offering.professionalId,
        fallback: 'UTC',
        requireValid: true,
      })
      if (!tzRes.ok) {
        return { ok: false as const, status: 400, error: 'This professional must set a valid timezone before taking bookings.' }
      }

      const apptTz = sanitizeTimeZone(tzRes.timeZone, 'UTC') || 'UTC'

      const stepMinutes = normalizeStepMinutes(loc.stepMinutes, 15)
      const leadTimeMinutes = clampInt(Number(loc.advanceNoticeMinutes ?? 0) || 0, 0, 24 * 60) // cap at 24h for sanity
      const maxDaysAhead = clampInt(Number(loc.maxDaysAhead ?? 365) || 365, 1, 3650)
      const bufferMinutes = clampInt(Number(loc.bufferMinutes ?? 0) || 0, 0, 180)

      // enforce lead-time + max-days-ahead
      if (requestedStart.getTime() < now.getTime() + leadTimeMinutes * 60_000) {
        return { ok: false as const, status: 400, error: 'Please pick a later time.' }
      }
      if (requestedStart.getTime() > now.getTime() + maxDaysAhead * 24 * 60 * 60_000) {
        return { ok: false as const, status: 400, error: 'That date is too far in the future.' }
      }

      // enforce step alignment in appointment TZ (authoritative)
      const startMin = minutesSinceMidnightInTimeZone(requestedStart, apptTz)
      if (startMin % stepMinutes !== 0) {
        return { ok: false as const, status: 400, error: `Start time must be on a ${stepMinutes}-minute boundary.` }
      }

      const durationMinutes = clampInt(
        pickDurationMinutes({
          locationType,
          salonDurationMinutes: offering.salonDurationMinutes,
          mobileDurationMinutes: offering.mobileDurationMinutes,
        }),
        15,
        12 * 60,
      )

      // IMPORTANT: include buffer in the reserved window
      const requestedEnd = addMinutes(requestedStart, durationMinutes + bufferMinutes)

      const whCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: loc.workingHours,
        timeZone: apptTz,
      })
      if (!whCheck.ok) {
        return { ok: false as const, status: 400, error: whCheck.error }
      }

      // blocks conflict (global or location-specific)
      const blocked = await tx.calendarBlock.findFirst({
        where: {
          professionalId: offering.professionalId,
          startsAt: { lt: requestedEnd },
          endsAt: { gt: requestedStart },
          OR: [{ locationId: loc.id }, { locationId: null }],
        },
        select: { id: true },
      })
      if (blocked) {
        return { ok: false as const, status: 409, error: 'That time is blocked. Try another slot.' }
      }

      // Bound queries to the local day in appt tz
      const { dayStartUtc, dayEndExclusiveUtc } = getDayWindowUtcFromUtcInstant({
        instantUtc: requestedStart,
        timeZone: apptTz,
      })

      // booking conflicts (same location)
      const existingBookings = await tx.booking.findMany({
        where: {
          professionalId: offering.professionalId,
          locationId: loc.id,
          scheduledFor: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
          NOT: { status: BookingStatus.CANCELLED },
        },
        select: { scheduledFor: true, totalDurationMinutes: true, bufferMinutes: true, status: true },
        take: 3000,
      })

      const bookingConflict = existingBookings.some((b) => {
        if (b.status === BookingStatus.CANCELLED) return false
        const bStart = normalizeToMinute(new Date(b.scheduledFor))
        const bDur = clampInt(Number(b.totalDurationMinutes ?? 0) || 60, 15, 12 * 60)
        const bBuf = clampInt(Number(b.bufferMinutes ?? 0) || 0, 0, 180)
        const bEnd = addMinutes(bStart, bDur + bBuf)
        return overlaps(bStart, bEnd, requestedStart, requestedEnd)
      })
      if (bookingConflict) {
        return { ok: false as const, status: 409, error: 'That time was just taken.' }
      }

      // hold conflicts (overlap-aware, not just same start)
      const holds = await tx.bookingHold.findMany({
        where: {
          professionalId: offering.professionalId,
          locationId: loc.id,
          locationType,
          expiresAt: { gt: now },
          scheduledFor: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
        },
        select: { scheduledFor: true, offeringId: true },
        take: 3000,
      })

      if (holds.length) {
        const holdOfferingIds = Array.from(new Set(holds.map((h) => h.offeringId))).slice(0, 2000)
        const holdOfferings = await tx.professionalServiceOffering.findMany({
          where: { id: { in: holdOfferingIds } },
          select: { id: true, salonDurationMinutes: true, mobileDurationMinutes: true },
          take: 2000,
        })
        const byId = new Map(holdOfferings.map((o) => [o.id, o]))

        const holdConflict = holds.some((h) => {
          const o = byId.get(h.offeringId)
          const hDur = clampInt(
            pickDurationMinutes({
              locationType,
              salonDurationMinutes: o?.salonDurationMinutes ?? null,
              mobileDurationMinutes: o?.mobileDurationMinutes ?? null,
            }),
            15,
            12 * 60,
          )
          const hStart = normalizeToMinute(new Date(h.scheduledFor))
          const hEnd = addMinutes(hStart, hDur + bufferMinutes)
          return overlaps(hStart, hEnd, requestedStart, requestedEnd)
        })

        if (holdConflict) {
          return { ok: false as const, status: 409, error: 'Someone is already holding that time. Try another slot.' }
        }
      }

      const expiresAt = addMinutes(now, HOLD_MINUTES)

      const addressSnapshot: Prisma.InputJsonValue | undefined =
        typeof loc.formattedAddress === 'string' && loc.formattedAddress.trim()
          ? ({ formattedAddress: loc.formattedAddress.trim() } satisfies Prisma.InputJsonObject)
          : undefined

      try {
        const hold = await tx.bookingHold.create({
          data: {
            offeringId: offering.id,
            professionalId: offering.professionalId,
            clientId,
            scheduledFor: requestedStart,
            expiresAt,
            locationType,

            locationId: loc.id,
            locationTimeZone: apptTz,

            locationAddressSnapshot: addressSnapshot,
            locationLatSnapshot: decimalToNumber(loc.lat),
            locationLngSnapshot: decimalToNumber(loc.lng),
          },
          select: {
            id: true,
            expiresAt: true,
            scheduledFor: true,
            locationType: true,
            locationId: true,
            locationTimeZone: true,
          },
        })

        return { ok: true as const, status: 201, hold }
      } catch (e: unknown) {
        // Race-safe fallback for @@unique([locationId, scheduledFor])
        const err = e as { code?: unknown }
        if (err?.code === 'P2002') {
          return { ok: false as const, status: 409, error: 'Someone is already holding that time. Try another slot.' }
        }
        throw e
      }
    })

    if (!result.ok) return jsonFail(result.status, result.error)
    return jsonOk({ hold: result.hold }, result.status)
  } catch (e) {
    console.error('POST /api/holds error', e)
    return jsonFail(500, 'Failed to create hold.')
  }
}