// lib/booking/conflicts.ts
import type { ServiceLocationType } from '@prisma/client'
import { clampInt } from '@/lib/pick'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_OTHER_OVERLAP_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'

export type BusyInterval = {
  start: Date
  end: Date
}

export type BookingLike = {
  scheduledFor: Date
  totalDurationMinutes: number | null
  bufferMinutes: number | null
}

export type HoldLike = {
  scheduledFor: Date
  locationType: ServiceLocationType | string
}

export function normalizeToMinute(date: Date): Date {
  const normalized = new Date(date)
  normalized.setSeconds(0, 0)
  return normalized
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && aEnd > bStart
}

export function durationOrFallback(
  duration: unknown,
  fallback = DEFAULT_DURATION_MINUTES,
): number {
  const parsed = Number(duration ?? 0)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return clampInt(fallback, 15, MAX_SLOT_DURATION_MINUTES)
  }

  return clampInt(parsed, 15, MAX_SLOT_DURATION_MINUTES)
}

export function bufferOrZero(buffer: unknown): number {
  return clampInt(Number(buffer ?? 0) || 0, 0, MAX_BUFFER_MINUTES)
}

/**
 * The MINIMUM durable busy length (minutes) any active booking/hold occupies,
 * mirroring the database EXCLUDE constraint exactly:
 *
 *   tovis_booking_overlap_range = GREATEST(1, COALESCE(dur,0) + COALESCE(buf,0))
 *
 * (see prisma/migrations/20260522000000_add_booking_overlap_exclusion).
 *
 * The JS builders intentionally reserve >= this (duration floored to 15 /
 * defaulted to 60, buffer clamped) so availability never *under*-reserves
 * relative to the DB. The contract that actually matters for correctness is:
 * every JS/runtime busy window must be >= this SQL floor, or availability could
 * clear a slot the database then rejects with a 23P01. The integration parity
 * test (tests/integration/busy-window-sql-parity.test.ts) pins that invariant
 * against the real Postgres function across the null/clamp/over-cap matrix.
 */
export function sqlBusyWindowMinutes(
  durationMinutes: number | null | undefined,
  bufferMinutes: number | null | undefined,
): number {
  return Math.max(
    1,
    coalesceWindowMinutes(durationMinutes) + coalesceWindowMinutes(bufferMinutes),
  )
}

function coalesceWindowMinutes(value: number | null | undefined): number {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.trunc(parsed)
}

export function getConflictWindowStart(start: Date): Date {
  return addMinutes(start, -MAX_OTHER_OVERLAP_MINUTES)
}

export function bookingToBusyInterval(
  booking: BookingLike,
  fallbackDurationMinutes = DEFAULT_DURATION_MINUTES,
): BusyInterval {
  const start = normalizeToMinute(new Date(booking.scheduledFor))
  const duration = durationOrFallback(
    booking.totalDurationMinutes,
    fallbackDurationMinutes,
  )
  const buffer = bufferOrZero(booking.bufferMinutes)

  return {
    start,
    end: addMinutes(start, duration + buffer),
  }
}

export function holdToBusyInterval(args: {
  hold: HoldLike
  salonDurationMinutes: number | null | undefined
  mobileDurationMinutes: number | null | undefined
  fallbackDurationMinutes?: number
  bufferMinutes: number
}): BusyInterval {
  const {
    hold,
    salonDurationMinutes,
    mobileDurationMinutes,
    fallbackDurationMinutes = DEFAULT_DURATION_MINUTES,
    bufferMinutes,
  } = args

  const start = normalizeToMinute(new Date(hold.scheduledFor))
  const normalizedLocationType = String(hold.locationType ?? '')
    .trim()
    .toUpperCase()

  const rawDuration =
    normalizedLocationType === 'MOBILE'
      ? mobileDurationMinutes
      : salonDurationMinutes

  const duration = durationOrFallback(rawDuration, fallbackDurationMinutes)
  const safeBuffer = bufferOrZero(bufferMinutes)

  return {
    start,
    end: addMinutes(start, duration + safeBuffer),
  }
}

export function mergeBusyIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = intervals
    .filter((interval) => interval.start.getTime() < interval.end.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const merged: BusyInterval[] = []

  for (const interval of sorted) {
    const previous = merged[merged.length - 1]

    if (!previous) {
      merged.push({
        start: new Date(interval.start),
        end: new Date(interval.end),
      })
      continue
    }

    if (interval.start.getTime() <= previous.end.getTime()) {
      if (interval.end.getTime() > previous.end.getTime()) {
        previous.end = new Date(interval.end)
      }
      continue
    }

    merged.push({
      start: new Date(interval.start),
      end: new Date(interval.end),
    })
  }

  return merged
}

/**
 * Assumes busyIntervals are already sorted by start time.
 * Best used with mergeBusyIntervals().
 */
export function hasBusyConflict(
  busyIntervals: BusyInterval[],
  requestedStart: Date,
  requestedEnd: Date,
): boolean {
  for (const interval of busyIntervals) {
    if (interval.start.getTime() >= requestedEnd.getTime()) {
      return false
    }

    if (overlaps(interval.start, interval.end, requestedStart, requestedEnd)) {
      return true
    }
  }

  return false
}

export function isSlotFree(
  busyIntervals: BusyInterval[],
  requestedStart: Date,
  requestedEnd: Date,
): boolean {
  return !hasBusyConflict(busyIntervals, requestedStart, requestedEnd)
}