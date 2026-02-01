// app/pro/calendar/_utils/date.ts
import {
  isValidIanaTimeZone,
  ymdInTimeZone,
  minutesSinceMidnightInTimeZone,
  timeZoneOffsetMinutes,
  zonedTimeToUtc as zonedToUtc,
  startOfDayUtcInTimeZone,
  utcFromDayAndMinutesInTimeZone,
  getZonedParts,
} from '@/lib/timeZone'

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/**
 * ✅ Single source of truth:
 * Legacy calendar used Monday-start weeks. Keep it consistent everywhere.
 */
const WEEK_START: 'MON' | 'SUN' = 'MON'

/**
 * ⚠️ Browser-local helpers (legacy)
 * Keep for non-calendar usage only. Calendar UI should use TZ helpers below.
 */
export function startOfDay(d: Date) {
  const nd = new Date(d)
  nd.setHours(0, 0, 0, 0)
  return nd
}

export function addDays(d: Date, days: number) {
  const nd = new Date(d)
  nd.setDate(nd.getDate() + days)
  return nd
}

/**
 * Legacy startOfWeek(): Monday start.
 * (diff = (day + 6) % 7)
 */
export function startOfWeek(d: Date) {
  const nd = startOfDay(d)
  const day = nd.getDay()
  const diff = (day + 6) % 7
  nd.setDate(nd.getDate() - diff)
  return nd
}

export function startOfMonth(d: Date) {
  const nd = new Date(d.getFullYear(), d.getMonth(), 1)
  nd.setHours(0, 0, 0, 0)
  return nd
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatDayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatMonthRange(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function formatWeekRange(d: Date) {
  const weekStart = startOfWeek(d)
  const weekEnd = addDays(weekStart, 6)
  const startStr = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const endStr = weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${startStr} – ${endStr}`
}

/* ---------------------------------------------
   ✅ TZ-safe helpers for calendar UI
   --------------------------------------------- */

export function parseYmd(ymd: string): { year: number; month: number; day: number } | null {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

export function ymdPartsInTimeZone(d: Date, timeZone: string) {
  const ymd = ymdInTimeZone(d, timeZone)
  const parts = parseYmd(ymd)
  if (!parts) return { year: 1970, month: 1, day: 1 }
  return parts
}

export function isSameDayInTimeZone(a: Date, b: Date, timeZone: string) {
  return ymdInTimeZone(a, timeZone) === ymdInTimeZone(b, timeZone)
}

export function dayNumberInTimeZone(d: Date, timeZone: string) {
  return ymdPartsInTimeZone(d, timeZone).day
}

export function monthIndexInTimeZone(d: Date, timeZone: string) {
  return ymdPartsInTimeZone(d, timeZone).month - 1
}

export function yearInTimeZone(d: Date, timeZone: string) {
  return ymdPartsInTimeZone(d, timeZone).year
}

export function formatDayLabelInTimeZone(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(d)
}

export function formatMonthRangeInTimeZone(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone, month: 'long', year: 'numeric' }).format(d)
}

/**
 * DST-safe "focus date" anchor:
 * represent the chosen calendar day as local NOON in the calendar TZ, stored as a UTC Date.
 */
export function anchorNoonInTimeZone(dayUtc: Date, timeZone: string) {
  const p = getZonedParts(dayUtc, timeZone)
  return zonedToUtc({
    year: p.year,
    month: p.month,
    day: p.day,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

export function addDaysAnchorNoonInTimeZone(anchorUtc: Date, deltaDays: number, timeZone: string) {
  const p = getZonedParts(anchorUtc, timeZone)
  return zonedToUtc({
    year: p.year,
    month: p.month,
    day: p.day + deltaDays,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

function dowInTimeZone(anchorUtc: Date, timeZone: string): number {
  // 0..6 Sunday..Saturday
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(anchorUtc)
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[wd] ?? 0
}

export function startOfWeekAnchorNoonInTimeZone(anchorUtc: Date, timeZone: string) {
  const dow = dowInTimeZone(anchorUtc, timeZone)

  // For Monday-start: diff = (dow + 6) % 7
  // For Sunday-start: diff = dow
  const diff = WEEK_START === 'MON' ? (dow + 6) % 7 : dow

  const p = getZonedParts(anchorUtc, timeZone)
  return zonedToUtc({
    year: p.year,
    month: p.month,
    day: p.day - diff,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

export function startOfMonthAnchorNoonInTimeZone(anchorUtc: Date, timeZone: string) {
  const p = getZonedParts(anchorUtc, timeZone)
  return zonedToUtc({
    year: p.year,
    month: p.month,
    day: 1,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

export function addMonthsAnchorNoonInTimeZone(anchorUtc: Date, deltaMonths: number, timeZone: string) {
  const p = getZonedParts(anchorUtc, timeZone)
  return zonedToUtc({
    year: p.year,
    month: p.month + deltaMonths,
    day: p.day,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  })
}

export function formatWeekRangeInTimeZone(anchorUtc: Date, timeZone: string) {
  const weekStartNoonUtc = startOfWeekAnchorNoonInTimeZone(anchorUtc, timeZone)
  const startUtc = startOfDayUtcInTimeZone(weekStartNoonUtc, timeZone)
  const endUtc = new Date(startUtc.getTime() + 6 * 24 * 60 * 60_000)

  const startStr = new Intl.DateTimeFormat(undefined, { timeZone, month: 'short', day: 'numeric' }).format(startUtc)
  const endStr = new Intl.DateTimeFormat(undefined, { timeZone, month: 'short', day: 'numeric' }).format(endUtc)

  return `${startStr} – ${endStr}`
}

export function toIso(d: Date) {
  return new Date(d).toISOString()
}

export function toDateInputValue(d: Date) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function toTimeInputValue(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function setDateTimeParts(baseDate: Date, hhmm: string) {
  const [hhStr, mmStr] = (hhmm || '').split(':')
  const hh = Number(hhStr)
  const mm = Number(mmStr)
  const out = new Date(baseDate)
  out.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
  return out
}

export function roundUpToNext15(date: Date) {
  const d = new Date(date)
  d.setSeconds(0, 0)
  const mins = d.getMinutes()
  const next = Math.ceil(mins / 15) * 15
  d.setMinutes(next === 60 ? 0 : next)
  if (next === 60) d.setHours(d.getHours() + 1)
  return d
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/* ---------------------------------------------
   Re-export TZ helpers from lib/timeZone
   --------------------------------------------- */

export {
  isValidIanaTimeZone,
  ymdInTimeZone,
  minutesSinceMidnightInTimeZone,
  timeZoneOffsetMinutes,
  zonedToUtc,
  startOfDayUtcInTimeZone,
  utcFromDayAndMinutesInTimeZone,
  getZonedParts,
}
