// app/pro/calendar/_utils/date.ts
import {
  isValidIanaTimeZone,
  ymdInTimeZone,
  minutesSinceMidnightInTimeZone,
  timeZoneOffsetMinutes,
  zonedTimeToUtc as zonedToUtc,
  startOfDayUtcInTimeZone,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/timeZone'

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

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
   (so the rest of the calendar code doesn’t need
    to be refactored all at once)
   --------------------------------------------- */

export {
  isValidIanaTimeZone,
  ymdInTimeZone,
  minutesSinceMidnightInTimeZone,
  timeZoneOffsetMinutes,
  zonedToUtc,
  startOfDayUtcInTimeZone,
  utcFromDayAndMinutesInTimeZone,
}
