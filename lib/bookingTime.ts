// lib/bookingTime.ts
/**
 * Booking-time helpers (single source for UI + API boundaries)
 * - Uses lib/timeZone.ts for DST-safe conversions
 * - Uses FormatInTimeZone.ts for consistent formatting
 *
 * Rule: store instants as UTC ISO strings. Only format in a timezone at the edges.
 */

import { sanitizeTimeZone, getZonedParts, zonedTimeToUtc, ymdInTimeZone } from '@/lib/timeZone'
import { formatInTimeZone } from '@/lib/FormatInTimeZone'

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
