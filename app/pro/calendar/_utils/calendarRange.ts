// app/pro/calendar/_utils/calendarRange.ts
//
// Pure helpers for view-range computation and timezone-aware formatting.
// Zero React dependency.

import type { ViewMode } from '../_types'

import {
  DAY_VIEW_VISIBLE_DAY_COUNT,
  MONTH_GRID_DAY_COUNT,
  MS_PER_DAY,
  WEEK_VIEW_VISIBLE_DAY_COUNT,
} from '../_constants'

import { WEEK_START } from './date'

import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'

// ─── Types ────────────────────────────────────────────────────────────────────

type DateRange = {
  from: Date
  to: Date
}

type LocalDateParts = {
  year: number
  month: number
  day: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAY_INDEX_SUNDAY_START: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function safeTimeZone(timeZone: string): string {
  return sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
}

function rangeFromStartAndDays(from: Date, dayCount: number): DateRange {
  return {
    from,
    to: new Date(from.getTime() + dayCount * MS_PER_DAY),
  }
}

function weekdayIndexInTimeZone(dateUtc: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(dateUtc)

  return WEEKDAY_INDEX_SUNDAY_START[weekday] ?? 0
}

function weekStartOffsetFromSundayIndex(sundayStartIndex: number): number {
  if (WEEK_START === 'MON') {
    return (sundayStartIndex + 6) % WEEK_VIEW_VISIBLE_DAY_COUNT
  }

  return sundayStartIndex
}

function localMidnightUtc(parts: LocalDateParts, timeZone: string): Date {
  return zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone,
  })
}

function localNoonUtc(parts: LocalDateParts, timeZone: string): Date {
  return zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

function startOfWeekUtcInTimeZone(
  focusUtc: Date,
  timeZone: string,
): Date {
  const focusParts = getZonedParts(focusUtc, timeZone)
  const weekdayIndex = weekdayIndexInTimeZone(focusUtc, timeZone)
  const offsetDays = weekStartOffsetFromSundayIndex(weekdayIndex)

  return localMidnightUtc(
    {
      year: focusParts.year,
      month: focusParts.month,
      day: focusParts.day - offsetDays,
    },
    timeZone,
  )
}

function startOfMonthGridUtcInTimeZone(
  focusUtc: Date,
  timeZone: string,
): Date {
  const focusParts = getZonedParts(focusUtc, timeZone)

  const firstOfMonthNoonUtc = localNoonUtc(
    {
      year: focusParts.year,
      month: focusParts.month,
      day: 1,
    },
    timeZone,
  )

  const firstOfMonthParts = getZonedParts(firstOfMonthNoonUtc, timeZone)
  const firstWeekdayIndex = weekdayIndexInTimeZone(
    firstOfMonthNoonUtc,
    timeZone,
  )
  const offsetDays = weekStartOffsetFromSundayIndex(firstWeekdayIndex)

  return localMidnightUtc(
    {
      year: firstOfMonthParts.year,
      month: firstOfMonthParts.month,
      day: firstOfMonthParts.day - offsetDays,
    },
    timeZone,
  )
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Anchor a day to local noon for working-hours weekday math.
 * This is not timezone conversion; it is a stable browser-local Date anchor.
 */
export function anchorDayLocalNoon(
  year: number,
  month1: number,
  day: number,
): Date {
  return new Date(year, month1 - 1, day, 12, 0, 0, 0)
}

export function toDateInputValueInTimeZone(
  dateUtc: Date,
  timeZone: string,
): string {
  const parts = getZonedParts(dateUtc, safeTimeZone(timeZone))

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

export function toTimeInputValueInTimeZone(
  dateUtc: Date,
  timeZone: string,
): string {
  const parts = getZonedParts(dateUtc, safeTimeZone(timeZone))

  return `${pad2(parts.hour)}:${pad2(parts.minute)}`
}

export function toDatetimeLocalValueInTimeZone(
  dateUtc: Date,
  timeZone: string,
): string {
  return [
    toDateInputValueInTimeZone(dateUtc, timeZone),
    toTimeInputValueInTimeZone(dateUtc, timeZone),
  ].join('T')
}

export function rangeForViewUtcInTimeZone(
  view: ViewMode,
  focusUtc: Date,
  timeZone: string,
): DateRange {
  const resolvedTimeZone = safeTimeZone(timeZone)

  if (view === 'day') {
    return rangeFromStartAndDays(
      startOfDayUtcInTimeZone(focusUtc, resolvedTimeZone),
      DAY_VIEW_VISIBLE_DAY_COUNT,
    )
  }

  if (view === 'week') {
    return rangeFromStartAndDays(
      startOfWeekUtcInTimeZone(focusUtc, resolvedTimeZone),
      WEEK_VIEW_VISIBLE_DAY_COUNT,
    )
  }

  return rangeFromStartAndDays(
    startOfMonthGridUtcInTimeZone(focusUtc, resolvedTimeZone),
    MONTH_GRID_DAY_COUNT,
  )
}