// lib/bookingTime.ts
/**
 * Booking-time helpers (single source for UI + API boundaries)
 * - Uses lib/timeZone.ts for DST-safe conversions
 * - Uses formatInTimeZone.ts for consistent formatting
 *
 * Rule: store instants as UTC ISO strings. Only format in a timezone at the edges.
 */

import { sanitizeTimeZone, getZonedParts, zonedTimeToUtc, ymdInTimeZone } from '@/lib/timeZone'
import { formatInTimeZone } from '@/lib/formatInTimeZone'
import { zonedPartsToUtcStrict } from '@/lib/booking/dateTime'

type DateLike = Date | string | number

function toDate(v: DateLike): Date | null {
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * YYYY-MM-DD in the given timezone from an ISO UTC instant string.
 */
export function ymdInTimeZoneFromIso(isoUtc: string, timeZone: string): string | null {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return null
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return ymdInTimeZone(d, tz)
}

/**
 * Get viewer/browser timezone if available and valid.
 * Use only for hints, not scheduling logic.
 */
export function getViewerTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null
    if (!tz) return null
    // sanitizeTimeZone already validates and falls back; we want null if invalid
    const sanitized = sanitizeTimeZone(tz, '')
    return sanitized ? sanitized : null
  } catch {
    return null
  }
}

/**
 * Format a slot time (short label) in a specific timezone.
 * Example: "Tue 2:15 PM"
 */
export function formatSlotLabel(isoUtc: string, timeZone: string, locale?: string): string {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return 'Invalid time'

  return formatInTimeZone(
    d,
    tz,
    {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    },
    locale,
  )
}

/**
 * Full label for tooltips / accessibility.
 * Example: "Tue, Jan 6, 2026, 2:15 PM"
 */
export function formatSlotFullLabel(isoUtc: string, timeZone: string, locale?: string): string {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return ''

  return formatInTimeZone(
    d,
    tz,
    {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
    locale,
  )
}

/**
 * Hour (0-23) of a UTC instant in the given timezone.
 * Used for "Morning / Afternoon / Evening" bucketing.
 */
export function getHourInTimeZone(isoUtc: string, timeZone: string): number | null {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return null
  const parts = getZonedParts(d, tz)
  return Number.isFinite(parts.hour) ? parts.hour : null
}

/**
 * The three booking dayparts surfaced to clients as Morning / Afternoon /
 * Evening filters. Shared by the in-app AvailabilityDrawer and the public
 * aftercare rebook card so both bucket slots identically.
 */
export type DayPeriod = 'MORNING' | 'AFTERNOON' | 'EVENING'

export const DAY_PERIOD_ORDER: readonly DayPeriod[] = [
  'MORNING',
  'AFTERNOON',
  'EVENING',
]

/** Bucket an hour (0-23, already resolved in the appointment tz) into a daypart. */
export function dayPeriodOfHour(hour: number): DayPeriod {
  if (hour < 12) return 'MORNING'
  if (hour < 17) return 'AFTERNOON'
  return 'EVENING'
}

/**
 * Group UTC slot ISO strings into Morning / Afternoon / Evening buckets using
 * the hour each slot falls on *in the appointment timezone*. Slots whose hour
 * can't be resolved are dropped.
 */
export function groupSlotsByPeriod(
  slots: readonly string[],
  timeZone: string,
): Record<DayPeriod, string[]> {
  const grouped: Record<DayPeriod, string[]> = {
    MORNING: [],
    AFTERNOON: [],
    EVENING: [],
  }

  for (const isoUtc of slots) {
    const hour = getHourInTimeZone(isoUtc, timeZone)
    if (hour == null) continue
    grouped[dayPeriodOfHour(hour)].push(isoUtc)
  }

  return grouped
}

/**
 * Pick the daypart to open to: keep `preferred` when it has slots, otherwise
 * fall back to the first daypart (in Morning→Evening order) that has one.
 * Returns `preferred` when every bucket is empty so callers keep a stable tab.
 */
export function firstNonEmptyPeriod(
  grouped: Record<DayPeriod, string[]>,
  preferred: DayPeriod,
): DayPeriod {
  if (grouped[preferred].length > 0) return preferred
  for (const period of DAY_PERIOD_ORDER) {
    if (grouped[period].length > 0) return period
  }
  return preferred
}

/**
 * Convert a datetime-local input ("YYYY-MM-DDTHH:mm") into a UTC ISO instant,
 * interpreted as occurring in the provided timezone.
 *
 * This is the correct way to treat datetime-local when the "meaning" is in pro tz.
 */
export function toISOFromDatetimeLocalInTimeZone(value: string, timeZone: string): string | null {
  if (!value) return null

  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null

  const tz = sanitizeTimeZone(timeZone, 'UTC')

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null
  }

  const utc = zonedTimeToUtc({ year, month, day, hour, minute, second: 0, timeZone: tz })
  if (Number.isNaN(utc.getTime())) return null
  return utc.toISOString()
}

/**
 * Result of a strict wall-clock -> UTC conversion for a human-picked time.
 * 'MALFORMED' = unparseable input; 'DST_INVALID' = the wall time does not exist
 * or is ambiguous on that day (a daylight-saving gap/overlap).
 */
export type WallTimeToUtcResult =
  | { ok: true; iso: string }
  | { ok: false; reason: 'MALFORMED' | 'DST_INVALID' }

/** User-facing copy for each WallTimeToUtcResult failure reason. */
export const WALL_TIME_ERROR_MESSAGE: Record<
  Exclude<WallTimeToUtcResult, { ok: true }>['reason'],
  string
> = {
  MALFORMED: 'Enter a valid date and time.',
  DST_INVALID:
    "That time doesn't exist on this day due to daylight saving time. Please pick another time.",
}

/**
 * Strict wall-clock parts -> UTC ISO for a time a human explicitly picks.
 * Unlike the best-effort converters, this reports a DST gap/overlap so the UI
 * can ask for another time instead of silently shifting it.
 */
export function partsToUtcIsoStrict(parts: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second?: number
  timeZone: string
}): WallTimeToUtcResult {
  const ok = [parts.year, parts.month, parts.day, parts.hour, parts.minute].every(
    (n) => Number.isFinite(n),
  )
  if (!ok) return { ok: false, reason: 'MALFORMED' }

  try {
    const utc = zonedPartsToUtcStrict({
      ...parts,
      timeZone: sanitizeTimeZone(parts.timeZone, 'UTC'),
    })
    return { ok: true, iso: utc.toISOString() }
  } catch {
    return { ok: false, reason: 'DST_INVALID' }
  }
}

/**
 * Strict datetime-local ("YYYY-MM-DDTHH:mm") -> UTC ISO for a human-picked time.
 * Reports DST gaps/overlaps (see {@link partsToUtcIsoStrict}) instead of
 * silently shifting them, unlike {@link toISOFromDatetimeLocalInTimeZone}.
 */
export function datetimeLocalToUtcIsoStrict(
  value: string,
  timeZone: string,
): WallTimeToUtcResult {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '')
  if (!m) return { ok: false, reason: 'MALFORMED' }

  return partsToUtcIsoStrict({
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    timeZone,
  })
}

/**
 * Convert a UTC ISO instant into a datetime-local value ("YYYY-MM-DDTHH:mm")
 * as seen in the provided timezone.
 *
 * Useful for editing existing values in a form while staying in pro tz.
 */
export function isoToDatetimeLocalInTimeZone(isoUtc: string | null, timeZone: string): string {
  if (!isoUtc) return ''
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return ''

  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(d, tz)

  const yyyy = String(p.year).padStart(4, '0')
  const mm = String(p.month).padStart(2, '0')
  const dd = String(p.day).padStart(2, '0')
  const hh = String(p.hour).padStart(2, '0')
  const min = String(p.minute).padStart(2, '0')

  return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

/**
 * General formatter wrapper for booking surfaces.
 * Kept here to encourage importing bookingTime utilities instead of scattered Intl usage.
 */
export function formatInBookingTimeZone(
  date: DateLike,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
) {
  const d = toDate(date)
  if (!d) return 'Invalid date'
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return formatInTimeZone(d, tz, options, locale)
}
