// app/pro/bookings/[id]/aftercare/aftercareDates.ts
//
// Pure date helpers for the aftercare rebook controls:
//  - day/week/month stepping for the "next visit" datetime and the booking
//    window dates
//  - date-only (no time) handling for the booking window, converted to
//    tz-aware instants for the API (start-of-day / end-of-day)
//
// Calendar math for "YYYY-MM-DD" values is done in UTC so it is DST-agnostic
// (a calendar date has no time-of-day to shift). Conversion to an instant uses
// the pro's timezone via the shared timeZone helpers.

import {
  getZonedParts,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'

export type StepUnit = 'day' | 'week' | 'month'

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function ymdToUtcDate(ymd: string): Date | null {
  const m = YMD_RE.exec(ymd.trim())
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])

  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const dt = new Date(Date.UTC(year, month - 1, day))

  // Reject overflow dates like 2026-02-31 (which JS would roll forward).
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null
  }

  return dt
}

function utcDateToYmd(dt: Date): string {
  const year = String(dt.getUTCFullYear()).padStart(4, '0')
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(dt.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addDaysToYmd(ymd: string, days: number): string | null {
  const dt = ymdToUtcDate(ymd)
  if (!dt) return null
  dt.setUTCDate(dt.getUTCDate() + days)
  return utcDateToYmd(dt)
}

export function addMonthsToYmd(ymd: string, months: number): string | null {
  const dt = ymdToUtcDate(ymd)
  if (!dt) return null

  const targetDay = dt.getUTCDate()

  // Move to the 1st before shifting months so a long day-of-month never spills
  // into a later month (e.g. Jan 31 + 1mo -> Feb, clamped to Feb 28/29).
  dt.setUTCDate(1)
  dt.setUTCMonth(dt.getUTCMonth() + months)

  const lastDayOfMonth = new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0),
  ).getUTCDate()

  dt.setUTCDate(Math.min(targetDay, lastDayOfMonth))
  return utcDateToYmd(dt)
}

function addUnitToYmd(ymd: string, unit: StepUnit): string | null {
  if (unit === 'month') return addMonthsToYmd(ymd, 1)
  return addDaysToYmd(ymd, unit === 'week' ? 7 : 1)
}

/** Lexical compare works for valid YYYY-MM-DD strings. */
export function compareYmd(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function todayYmdInTimeZone(timeZone: string): string {
  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'
  const p = getZonedParts(new Date(), tz)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function isoToYmdInTimeZone(
  iso: string | null | undefined,
  timeZone: string,
): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'
  const p = getZonedParts(d, tz)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function ymdToIso(
  ymd: string,
  timeZone: string,
  hour: number,
  minute: number,
): string | null {
  const m = YMD_RE.exec(ymd.trim())
  if (!m) return null
  const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'
  const utc = zonedTimeToUtc({
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour,
    minute,
    second: 0,
    timeZone: tz,
  })
  return Number.isNaN(utc.getTime()) ? null : utc.toISOString()
}

/** Booking-window start: the first instant of the chosen date in the pro's tz. */
export function ymdToIsoStartOfDay(
  ymd: string,
  timeZone: string,
): string | null {
  return ymdToIso(ymd, timeZone, 0, 0)
}

/**
 * Booking-window end: the last usable minute of the chosen date in the pro's
 * tz, so the window is inclusive of the end date the pro picked.
 */
export function ymdToIsoEndOfDay(ymd: string, timeZone: string): string | null {
  return ymdToIso(ymd, timeZone, 23, 59)
}

/**
 * Step the date portion of a `datetime-local` value ("YYYY-MM-DDTHH:mm") by a
 * unit, preserving the time. If the value is empty/invalid, start from
 * `fallbackDateYmd` at noon (a safe default that avoids DST edge times).
 */
export function stepDatetimeLocal(
  value: string,
  unit: StepUnit,
  fallbackDateYmd: string,
): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim())
  const datePart = m?.[1] ?? fallbackDateYmd
  const timePart = m?.[2] ?? '12:00'
  const nextDate = addUnitToYmd(datePart, unit) ?? datePart
  return `${nextDate}T${timePart}`
}

/**
 * Step a date-only ("YYYY-MM-DD") value by a unit. If empty/invalid, start from
 * `fallbackDateYmd`.
 */
export function stepYmd(
  value: string,
  unit: StepUnit,
  fallbackDateYmd: string,
): string {
  const base = YMD_RE.test(value.trim()) ? value.trim() : fallbackDateYmd
  return addUnitToYmd(base, unit) ?? base
}
