// app/pro/calendar/_utils/date.ts

import type { WeekdayKey } from '../_types'

import {
  getZonedParts,
  isValidIanaTimeZone,
  minutesSinceMidnightInTimeZone,
  startOfDayUtcInTimeZone,
  timeZoneOffsetMinutes,
  utcFromDayAndMinutesInTimeZone,
  ymdInTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'

export const WEEK_START: 'MON' | 'SUN' = 'MON'

export const DAY_KEYS: ReadonlyArray<WeekdayKey> = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
]

export const WEEKDAY_KEYS_MON: ReadonlyArray<WeekdayKey> = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]

export const WEEKDAY_KEYS_DISPLAY: ReadonlyArray<WeekdayKey> =
  WEEK_START === 'MON' ? WEEKDAY_KEYS_MON : DAY_KEYS

type YmdParts = {
  year: number
  month: number
  day: number
}

const FALLBACK_YMD_PARTS: YmdParts = {
  year: 1970,
  month: 1,
  day: 1,
}

const DAY_MS = 24 * 60 * 60_000
const ROUND_UP_MINUTES = 15

const WEEKDAY_INDEX_BY_SHORT_LABEL: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function isFiniteDate(date: Date) {
  return Number.isFinite(date.getTime())
}

function safeDate(date: Date) {
  return isFiniteDate(date) ? date : new Date(0)
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function validYmdParts(parts: YmdParts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))

  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day
  )
}

function dateFormatter(
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone,
  })
}

function dateFormatterEnUs(
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone,
  })
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function weekdayIndexInTimeZone(anchorUtc: Date, timeZone: string) {
  const weekday = dateFormatterEnUs(timeZone, {
    weekday: 'short',
  }).format(anchorUtc)

  return WEEKDAY_INDEX_BY_SHORT_LABEL[weekday] ?? 0
}

function weekStartDiff(dayIndex: number) {
  return WEEK_START === 'MON' ? (dayIndex + 6) % 7 : dayIndex
}

/**
 * Browser-local helpers.
 * Calendar timezone math should prefer the timezone-safe helpers below.
 */
export function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

export function addDays(date: Date, days: number) {
  return addLocalDays(date, days)
}

/**
 * Browser-local week start.
 * Monday start: diff = (day + 6) % 7.
 */
export function startOfWeek(date: Date) {
  const next = startOfDay(date)
  const diff = weekStartDiff(next.getDay())

  next.setDate(next.getDate() - diff)
  return next
}

export function startOfMonth(date: Date) {
  const safe = safeDate(date)
  const next = new Date(safe.getFullYear(), safe.getMonth(), 1)

  next.setHours(0, 0, 0, 0)
  return next
}

export function isSameDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  )
}

export function formatDayLabel(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function formatMonthRange(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

export function formatWeekRange(date: Date) {
  const weekStart = startOfWeek(date)
  const weekEnd = addDays(weekStart, 6)

  const startLabel = weekStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

  const endLabel = weekEnd.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

  return `${startLabel} – ${endLabel}`
}

/* ---------------------------------------------
   Timezone-safe helpers for calendar UI
--------------------------------------------- */

export function parseYmd(ymd: string): YmdParts | null {
  const match = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!Number.isInteger(year) || year < 1900 || year > 3000) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  const parts = {
    year,
    month,
    day,
  }

  return validYmdParts(parts) ? parts : null
}

export function ymdPartsInTimeZone(date: Date, timeZone: string): YmdParts {
  const parts = parseYmd(ymdInTimeZone(date, timeZone))

  return parts ?? FALLBACK_YMD_PARTS
}

export function isSameDayInTimeZone(
  first: Date,
  second: Date,
  timeZone: string,
) {
  return ymdInTimeZone(first, timeZone) === ymdInTimeZone(second, timeZone)
}

export function dayNumberInTimeZone(date: Date, timeZone: string) {
  return ymdPartsInTimeZone(date, timeZone).day
}

export function monthIndexInTimeZone(date: Date, timeZone: string) {
  return ymdPartsInTimeZone(date, timeZone).month - 1
}

export function yearInTimeZone(date: Date, timeZone: string) {
  return ymdPartsInTimeZone(date, timeZone).year
}

export function formatDayLabelInTimeZone(date: Date, timeZone: string) {
  return dateFormatter(timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function formatMonthRangeInTimeZone(date: Date, timeZone: string) {
  return dateFormatter(timeZone, {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/**
 * DST-safe anchor:
 * represent the chosen calendar day as local noon in the calendar timezone,
 * stored as a UTC Date.
 */
export function anchorNoonInTimeZone(dayUtc: Date, timeZone: string) {
  const parts = getZonedParts(dayUtc, timeZone)

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

export function addDaysAnchorNoonInTimeZone(
  anchorUtc: Date,
  deltaDays: number,
  timeZone: string,
) {
  const parts = getZonedParts(anchorUtc, timeZone)

  return zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day + deltaDays,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

export function startOfWeekAnchorNoonInTimeZone(
  anchorUtc: Date,
  timeZone: string,
) {
  const dayIndex = weekdayIndexInTimeZone(anchorUtc, timeZone)
  const diff = weekStartDiff(dayIndex)
  const parts = getZonedParts(anchorUtc, timeZone)

  return zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day - diff,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

export function startOfMonthAnchorNoonInTimeZone(
  anchorUtc: Date,
  timeZone: string,
) {
  const parts = getZonedParts(anchorUtc, timeZone)

  return zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: 1,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

export function addMonthsAnchorNoonInTimeZone(
  anchorUtc: Date,
  deltaMonths: number,
  timeZone: string,
) {
  const parts = getZonedParts(anchorUtc, timeZone)

  return zonedTimeToUtc({
    year: parts.year,
    month: parts.month + deltaMonths,
    day: parts.day,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

export function formatWeekRangeInTimeZone(
  anchorUtc: Date,
  timeZone: string,
) {
  const weekStartNoonUtc = startOfWeekAnchorNoonInTimeZone(
    anchorUtc,
    timeZone,
  )

  const startUtc = startOfDayUtcInTimeZone(weekStartNoonUtc, timeZone)
  const endUtc = new Date(startUtc.getTime() + 6 * DAY_MS)

  const formatter = dateFormatter(timeZone, {
    month: 'short',
    day: 'numeric',
  })

  return `${formatter.format(startUtc)} – ${formatter.format(endUtc)}`
}

export function toIso(date: Date) {
  return new Date(date).toISOString()
}

export function toDateInputValue(date: Date) {
  const safe = safeDate(date)
  const year = safe.getFullYear()
  const month = pad2(safe.getMonth() + 1)
  const day = pad2(safe.getDate())

  return `${year}-${month}-${day}`
}

export function toTimeInputValue(date: Date) {
  const safe = safeDate(date)
  const hour = pad2(safe.getHours())
  const minute = pad2(safe.getMinutes())

  return `${hour}:${minute}`
}

export function setDateTimeParts(baseDate: Date, hhmm: string) {
  const [hourText, minuteText] = hhmm.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)

  const next = new Date(baseDate)

  next.setHours(
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
  )

  return next
}

export function roundUpToNext15(date: Date) {
  const next = new Date(date)

  next.setSeconds(0, 0)

  const minutes = next.getMinutes()
  const roundedMinutes =
    Math.ceil(minutes / ROUND_UP_MINUTES) * ROUND_UP_MINUTES

  if (roundedMinutes >= 60) {
    next.setMinutes(0)
    next.setHours(next.getHours() + 1)
    return next
  }

  next.setMinutes(roundedMinutes)
  return next
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/* ---------------------------------------------
   Re-export timezone helpers.
   Some calendar components import these from this file.
--------------------------------------------- */

export {
  getZonedParts,
  isValidIanaTimeZone,
  minutesSinceMidnightInTimeZone,
  startOfDayUtcInTimeZone,
  timeZoneOffsetMinutes,
  utcFromDayAndMinutesInTimeZone,
  ymdInTimeZone,
}