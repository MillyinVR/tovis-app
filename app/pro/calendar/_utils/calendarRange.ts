// app/pro/calendar/_utils/calendarRange.ts
//
// Pure helpers for view-range computation and timezone-aware formatting.
// Zero React dependency.

import type { ViewMode } from '../_types'
import {
  DEFAULT_TIME_ZONE,
  sanitizeTimeZone,
  getZonedParts,
  zonedTimeToUtc,
  startOfDayUtcInTimeZone,
} from '@/lib/timeZone'

// ── Day anchor ─────────────────────────────────────────────────────

/**
 * Anchor a "day" to local noon for working-hours weekday math (not timezone conversion).
 */
export function anchorDayLocalNoon(year: number, month1: number, day: number) {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0)
}

// ── Formatting ─────────────────────────────────────────────────────

export function pad2(n: number) {
  return String(n).padStart(2, '0')
}

export function toDateInputValueInTimeZone(dateUtc: Date, tz: string) {
  const p = getZonedParts(dateUtc, tz)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

export function toTimeInputValueInTimeZone(dateUtc: Date, tz: string) {
  const p = getZonedParts(dateUtc, tz)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

export function toDatetimeLocalValueInTimeZone(dateUtc: Date, tz: string) {
  return `${toDateInputValueInTimeZone(dateUtc, tz)}T${toTimeInputValueInTimeZone(dateUtc, tz)}`
}

// ── View range computation ─────────────────────────────────────────

const mapMon: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
}

export function rangeForViewUtcInTimeZone(v: ViewMode, focusUtc: Date, tz: string) {
  const safeTz = sanitizeTimeZone(tz, DEFAULT_TIME_ZONE)

  if (v === 'day') {
    const from = startOfDayUtcInTimeZone(focusUtc, safeTz)
    const to = new Date(from.getTime() + 24 * 60 * 60_000)
    return { from, to }
  }

  if (v === 'week') {
    const p = getZonedParts(focusUtc, safeTz)
    const weekdayShort = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      weekday: 'short',
    }).format(focusUtc)

    const dow = mapMon[weekdayShort] ?? 0
    const weekStartDay = p.day - dow

    const from = zonedTimeToUtc({
      year: p.year,
      month: p.month,
      day: weekStartDay,
      hour: 0,
      minute: 0,
      second: 0,
      timeZone: safeTz,
    })

    const to = new Date(from.getTime() + 7 * 24 * 60 * 60_000)
    return { from, to }
  }

  // month view
  const p = getZonedParts(focusUtc, safeTz)

  const firstOfMonthUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: 1,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone: safeTz,
  })

  const firstWeekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    weekday: 'short',
  }).format(firstOfMonthUtc)

  const firstDow = mapMon[firstWeekdayShort] ?? 0
  const firstParts = getZonedParts(firstOfMonthUtc, safeTz)
  const gridStartDay = firstParts.day - firstDow

  const from = zonedTimeToUtc({
    year: firstParts.year,
    month: firstParts.month,
    day: gridStartDay,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: safeTz,
  })

  const to = new Date(from.getTime() + 42 * 24 * 60 * 60_000)
  return { from, to }
}
