// app/pro/calendar/_utils/date.ts

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
   TIME ZONE HELPERS (Intl-only, no dependencies)
   --------------------------------------------- */

export function isValidIanaTimeZone(tz: string | null | undefined) {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

function dtfPartsInTimeZone(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

export function ymdInTimeZone(date: Date, timeZone: string) {
  const p = dtfPartsInTimeZone(date, timeZone)
  const yyyy = String(p.year).padStart(4, '0')
  const mm = String(p.month).padStart(2, '0')
  const dd = String(p.day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function minutesSinceMidnightInTimeZone(date: Date, timeZone: string) {
  const p = dtfPartsInTimeZone(date, timeZone)
  return p.hour * 60 + p.minute
}

export function isSameDayInTimeZone(a: Date, b: Date, timeZone: string) {
  return ymdInTimeZone(a, timeZone) === ymdInTimeZone(b, timeZone)
}

/**
 * Returns the offset (in minutes) between UTC and the given timeZone at the given instant.
 * Positive means timeZone is ahead of UTC.
 */
export function timeZoneOffsetMinutes(at: Date, timeZone: string) {
  const p = dtfPartsInTimeZone(at, timeZone)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const offsetMs = asIfUtc - at.getTime()
  return Math.round(offsetMs / 60_000)
}

/**
 * Convert a "zoned" date-time (YYYY-MM-DD hh:mm in a timeZone) to a real UTC Date instant.
 * This uses a small fixed-point iteration to handle DST edges.
 */
export function zonedToUtc(args: { year: number; month: number; day: number; hour: number; minute: number; second?: number }, timeZone: string) {
  const { year, month, day, hour, minute } = args
  const second = args.second ?? 0

  // initial guess: treat zoned time as if it were UTC
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

  // refine a few times (DST transitions)
  for (let i = 0; i < 4; i++) {
    const off = timeZoneOffsetMinutes(guess, timeZone)
    const corrected = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - off * 60_000)
    if (Math.abs(corrected.getTime() - guess.getTime()) < 500) return corrected
    guess = corrected
  }
  return guess
}

export function startOfDayUtcInTimeZone(date: Date, timeZone: string) {
  const p = dtfPartsInTimeZone(date, timeZone)
  return zonedToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 }, timeZone)
}

export function utcFromDayAndMinutesInTimeZone(day: Date, minutesFromMidnight: number, timeZone: string) {
  const p = dtfPartsInTimeZone(day, timeZone)
  const mins = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutesFromMidnight)))
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  return zonedToUtc({ year: p.year, month: p.month, day: p.day, hour: hh, minute: mm, second: 0 }, timeZone)
}
