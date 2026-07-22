// lib/looks/availabilityStats.ts
//
// ProfessionalAvailabilityStat refresh + serve-time reader — the per-pro
// calendar-availability primitive behind the Looks feed availability_boost term
// (personalization spec §4.2/§4.4). Mirrors the ProfessionalBadgeStat pattern
// (lib/looks/badges/stats.ts): a cron-refreshed aggregate, swapped in atomically
// (deleteMany + createMany), read cheaply by PK at serve time.
//
// The primitive is deliberately COARSE — a soft ranking weight, never a hard
// filter (guardrail #8). It answers two questions per pro, from real working
// hours + real occupancy (bookings, active holds, calendar blocks):
//   - nextOpeningDate: how soon is their next day with spare capacity?
//   - fullness14d:     how booked out are they over the next 14 working days?
//
// Approximations (all documented because a soft signal must stay honest):
//   - A pro's schedule = their PRIMARY bookable location's working hours + tz
//     (falling back to any bookable location, then the profile tz). A pro who
//     works multiple locations at different hours is summarized by one; the
//     alternative (union of windows) would OVERstate capacity, which is worse
//     for a signal meant to reward genuine openness.
//   - Capacity per day = the working-window length; booked = the occupancy
//     minutes overlapping that window, clamped to capacity. This is minute-level
//     fullness, NOT slot-level — it does not run the per-service slot engine
//     (too expensive for an all-pros hourly cron; see the recon note in the PR),
//     so it can't tell a genuinely bookable gap from a too-small one beyond the
//     minOpeningMinutes floor. Good enough to rank "open soon" above "booked out
//     six weeks"; not a booking guarantee.
//   - Working-window → UTC conversion ignores the (rare, ≤1h) DST shift inside a
//     day's window. Immaterial at this signal's resolution.
//
// Only pros with a real opening in the scan horizon get a row — a fully-booked
// pro is dropped (reads as "no availability signal" = boost 0 at serve time),
// keeping the table proportional to pros a client can actually book soon, the
// same "skip the zeros" rule the badge stats use.

import { type PrismaClient } from '@prisma/client'

import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'
import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/time'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'
import type { ProAvailabilitySignal } from '@/lib/looks/personalizedRanking'

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

export const PRO_AVAILABILITY_STAT = {
  // How many local days ahead the next-opening scan looks. A pro with no spare
  // capacity within this window is treated as "booked out" (no row).
  horizonDays: 30,
  // The window the fullness ratio / open-day count summarize (spec §4.2/§4.4
  // "calendar_fullness_next_14_days").
  fullnessWindowDays: 14,
  // Minimum spare working-minutes for a day to count as an "opening". A coarse
  // floor standing in for "a bookable slot fits" without running the slot engine.
  minOpeningMinutes: 30,
} as const

// A half-open occupancy interval [startUtc, endUtc) — the uniform shape every
// occupancy source (booking, hold, block) is reduced to before summarizing.
export type OccupancyInterval = {
  startUtc: Date
  endUtc: Date
}

export type ProAvailabilitySummary = {
  nextOpeningDate: Date | null
  openDayCount14d: number
  fullness14d: number
  capacityMinutes14d: number
  bookedMinutes14d: number
}

export type ProfessionalAvailabilityStatInput = {
  professionalId: string
  nextOpeningDate: Date | null
  openDayCount14d: number
  fullness14d: number
  capacityMinutes14d: number
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

/**
 * Overlap of two half-open intervals, in whole+fractional minutes (0 when they
 * don't overlap or either is degenerate/invalid). Pure + exported for testing.
 */
export function intervalOverlapMinutes(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): number {
  if (!isValidDate(aStart) || !isValidDate(aEnd)) return 0
  if (!isValidDate(bStart) || !isValidDate(bEnd)) return 0

  const start = Math.max(aStart.getTime(), bStart.getTime())
  const end = Math.min(aEnd.getTime(), bEnd.getTime())
  if (end <= start) return 0

  return (end - start) / MINUTE_MS
}

/** Add `days` calendar days to a local (year, month, day) via UTC arithmetic. */
function addCalendarDays(
  parts: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  d.setUTCDate(d.getUTCDate() + days)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

/**
 * Summarize one pro's near-term availability from their working hours + tz and a
 * flat list of occupancy intervals. Walks `horizonDays` local days from `now`;
 * for each day it derives the working-window UTC interval, floors it at `now` (so
 * a day whose window has already passed contributes no spurious capacity), sums
 * the occupancy overlapping that window (clamped to capacity), and records the
 * first day with >= minOpeningMinutes spare as the next opening. Fullness and the
 * open-day count summarize the first `fullnessWindowDays`. Deterministic given
 * its inputs (lib/time conversions are pure) → unit-testable without Prisma.
 */
export function computeProAvailabilitySummary(args: {
  now: Date
  timeZone: string
  workingHours: unknown
  occupancy: readonly OccupancyInterval[]
}): ProAvailabilitySummary {
  const tz = sanitizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
  const nowMs = args.now.getTime()
  const startParts = getZonedParts(args.now, tz)

  let nextOpeningDate: Date | null = null
  let openDayCount14d = 0
  let capacityMinutes14d = 0
  let bookedMinutes14d = 0

  for (let dayIndex = 0; dayIndex < PRO_AVAILABILITY_STAT.horizonDays; dayIndex += 1) {
    const ymd = addCalendarDays(startParts, dayIndex)
    const dayStartUtc = zonedTimeToUtc({
      year: ymd.year,
      month: ymd.month,
      day: ymd.day,
      hour: 0,
      minute: 0,
      timeZone: tz,
    })

    const window = getWorkingWindowForDay(dayStartUtc, args.workingHours, tz)
    if (!window.ok) continue

    // Working window as a UTC interval, floored at `now` so a partly-elapsed day
    // only offers its remaining capacity (matters for day 0).
    const rawWindowStartMs = dayStartUtc.getTime() + window.startMinutes * MINUTE_MS
    const windowEndMs = dayStartUtc.getTime() + window.endMinutes * MINUTE_MS
    const windowStartMs = Math.max(rawWindowStartMs, nowMs)
    if (windowEndMs <= windowStartMs) continue

    const windowStart = new Date(windowStartMs)
    const windowEnd = new Date(windowEndMs)
    const capacityMinutes = (windowEndMs - windowStartMs) / MINUTE_MS

    let bookedMinutes = 0
    for (const interval of args.occupancy) {
      bookedMinutes += intervalOverlapMinutes(
        interval.startUtc,
        interval.endUtc,
        windowStart,
        windowEnd,
      )
      if (bookedMinutes >= capacityMinutes) break
    }
    const clampedBooked = Math.min(bookedMinutes, capacityMinutes)
    const spareMinutes = capacityMinutes - clampedBooked

    if (
      nextOpeningDate === null &&
      spareMinutes >= PRO_AVAILABILITY_STAT.minOpeningMinutes
    ) {
      // Store the start-of-local-day instant — serve time only needs daysUntil.
      nextOpeningDate = dayStartUtc
    }

    if (dayIndex < PRO_AVAILABILITY_STAT.fullnessWindowDays) {
      capacityMinutes14d += capacityMinutes
      bookedMinutes14d += clampedBooked
      if (spareMinutes >= PRO_AVAILABILITY_STAT.minOpeningMinutes) {
        openDayCount14d += 1
      }
    }
  }

  const fullness14d =
    capacityMinutes14d > 0
      ? Math.min(Math.max(bookedMinutes14d / capacityMinutes14d, 0), 1)
      : 0

  return {
    nextOpeningDate,
    openDayCount14d,
    fullness14d,
    capacityMinutes14d: Math.round(capacityMinutes14d),
    bookedMinutes14d: Math.round(bookedMinutes14d),
  }
}

type ProSchedule = {
  workingHours: unknown
  timeZoneRaw: string | null
  // The owning pro's profile timezone — the fallback when the chosen location
  // has no timeZone of its own. Read via the location's relation so this stays a
  // single query (no separate professionalProfile read = not a discovery surface).
  profileTimeZoneRaw: string | null
  isPrimary: boolean
}

/** Booking → occupancy interval using its stored duration + buffer. */
function bookingInterval(row: {
  scheduledFor: Date
  totalDurationMinutes: number
  bufferMinutes: number
}): OccupancyInterval | null {
  if (!isValidDate(row.scheduledFor)) return null
  const minutes =
    (Number.isFinite(row.totalDurationMinutes) ? row.totalDurationMinutes : 0) +
    (Number.isFinite(row.bufferMinutes) ? row.bufferMinutes : 0)
  if (minutes <= 0) return null
  return {
    startUtc: row.scheduledFor,
    endUtc: new Date(row.scheduledFor.getTime() + minutes * MINUTE_MS),
  }
}

/** Active hold → occupancy interval (snapshot end, else duration+buffer). */
function holdInterval(row: {
  scheduledFor: Date
  durationMinutesSnapshot: number | null
  bufferMinutesSnapshot: number | null
  endsAtSnapshot: Date | null
}): OccupancyInterval | null {
  if (!isValidDate(row.scheduledFor)) return null
  if (isValidDate(row.endsAtSnapshot) && row.endsAtSnapshot > row.scheduledFor) {
    return { startUtc: row.scheduledFor, endUtc: row.endsAtSnapshot }
  }
  const minutes =
    (row.durationMinutesSnapshot ?? 0) + (row.bufferMinutesSnapshot ?? 0)
  if (minutes <= 0) return null
  return {
    startUtc: row.scheduledFor,
    endUtc: new Date(row.scheduledFor.getTime() + minutes * MINUTE_MS),
  }
}

export type RefreshProfessionalAvailabilityStatsResult = {
  professionals: number
  computedAt: Date
}

/**
 * Recompute ProfessionalAvailabilityStat for every pro with a bookable schedule
 * and swap the table contents in atomically. Loads each pro's schedule (primary
 * bookable location) + tz, the horizon window's occupancy (bookings, active
 * holds, calendar blocks) in three bulk queries, buckets by pro, summarizes each,
 * and keeps only pros with a real opening in the horizon.
 */
export async function refreshProfessionalAvailabilityStats(
  db: PrismaClient,
  now: Date,
): Promise<RefreshProfessionalAvailabilityStatsResult> {
  const locations = await db.professionalLocation.findMany({
    where: { isBookable: true, archivedAt: null },
    select: {
      professionalId: true,
      isPrimary: true,
      workingHours: true,
      timeZone: true,
      professional: { select: { timeZone: true } },
    },
  })

  // One schedule per pro: prefer the primary bookable location, else the first.
  const scheduleByPro = new Map<string, ProSchedule>()
  for (const loc of locations) {
    const existing = scheduleByPro.get(loc.professionalId)
    if (!existing || (loc.isPrimary && !existing.isPrimary)) {
      scheduleByPro.set(loc.professionalId, {
        workingHours: loc.workingHours,
        timeZoneRaw: loc.timeZone,
        profileTimeZoneRaw: loc.professional?.timeZone ?? null,
        isPrimary: loc.isPrimary,
      })
    }
  }

  const professionalIds = [...scheduleByPro.keys()]
  if (professionalIds.length === 0) {
    await db.professionalAvailabilityStat.deleteMany({})
    return { professionals: 0, computedAt: now }
  }

  // Generous UTC window covering the local horizon for every timezone.
  const windowStart = new Date(now.getTime() - DAY_MS)
  const windowEnd = new Date(
    now.getTime() + (PRO_AVAILABILITY_STAT.horizonDays + 1) * DAY_MS,
  )

  const [bookings, holds, blocks] = await Promise.all([
    db.booking.findMany({
      where: {
        professionalId: { in: professionalIds },
        // The shared occupancy set (F8), not a local copy — fullness must count
        // the same bookings availability refuses to book over. This used to
        // omit COMPLETED on the theory that "completed is in the past", which
        // an early-finished or same-day session makes false, understating how
        // booked the pro really is.
        status: { in: [...BOOKING_BLOCKING_STATUSES] },
        scheduledFor: { gte: windowStart, lt: windowEnd },
      },
      select: {
        professionalId: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
      },
    }),
    db.bookingHold.findMany({
      where: {
        professionalId: { in: professionalIds },
        expiresAt: { gt: now },
        scheduledFor: { lt: windowEnd },
      },
      select: {
        professionalId: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
        bufferMinutesSnapshot: true,
        endsAtSnapshot: true,
      },
    }),
    db.calendarBlock.findMany({
      where: {
        professionalId: { in: professionalIds },
        startsAt: { lt: windowEnd },
        endsAt: { gt: windowStart },
      },
      select: { professionalId: true, startsAt: true, endsAt: true },
    }),
  ])

  const occupancyByPro = new Map<string, OccupancyInterval[]>()
  const pushInterval = (proId: string, interval: OccupancyInterval | null) => {
    if (!interval) return
    const list = occupancyByPro.get(proId)
    if (list) list.push(interval)
    else occupancyByPro.set(proId, [interval])
  }
  for (const b of bookings) pushInterval(b.professionalId, bookingInterval(b))
  for (const h of holds) pushInterval(h.professionalId, holdInterval(h))
  for (const blk of blocks) {
    if (!isValidDate(blk.startsAt) || !isValidDate(blk.endsAt)) continue
    if (blk.endsAt <= blk.startsAt) continue
    pushInterval(blk.professionalId, {
      startUtc: blk.startsAt,
      endUtc: blk.endsAt,
    })
  }

  const rows: ProfessionalAvailabilityStatInput[] = []
  for (const [professionalId, schedule] of scheduleByPro) {
    const timeZone = sanitizeTimeZone(
      schedule.timeZoneRaw ?? schedule.profileTimeZoneRaw ?? undefined,
      DEFAULT_TIME_ZONE,
    )
    const summary = computeProAvailabilitySummary({
      now,
      timeZone,
      workingHours: schedule.workingHours,
      occupancy: occupancyByPro.get(professionalId) ?? [],
    })
    // Skip pros with no opening in the horizon — a missing row reads the same as
    // "no availability signal" (boost 0), keeping the table proportional.
    if (summary.nextOpeningDate === null) continue
    rows.push({
      professionalId,
      nextOpeningDate: summary.nextOpeningDate,
      openDayCount14d: summary.openDayCount14d,
      fullness14d: summary.fullness14d,
      capacityMinutes14d: summary.capacityMinutes14d,
    })
  }

  await db.$transaction([
    db.professionalAvailabilityStat.deleteMany({}),
    ...(rows.length > 0
      ? [
          db.professionalAvailabilityStat.createMany({
            data: rows.map((row) => ({ ...row, computedAt: now })),
          }),
        ]
      : []),
  ])

  return { professionals: rows.length, computedAt: now }
}

/**
 * Serve-time reader: load the availability signals for a page's pros, keyed by
 * professionalId. A pro without a row (no opening in the horizon) is simply
 * absent from the map → 0 availability boost. One indexed read by PK.
 */
export async function fetchProAvailabilitySignals(
  db: PrismaClient,
  professionalIds: readonly string[],
): Promise<Map<string, ProAvailabilitySignal>> {
  const ids = [...new Set(professionalIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return new Map()

  const rows = await db.professionalAvailabilityStat.findMany({
    where: { professionalId: { in: ids } },
    select: {
      professionalId: true,
      nextOpeningDate: true,
      fullness14d: true,
    },
  })

  const map = new Map<string, ProAvailabilitySignal>()
  for (const row of rows) {
    map.set(row.professionalId, {
      nextOpeningDate: row.nextOpeningDate,
      fullness14d: row.fullness14d,
    })
  }
  return map
}
