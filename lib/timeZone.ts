// lib/timeZone.ts
/**
 * Single source of truth for timezone ops across the app.
 * - Intl-only (no deps)
 * - Handles DST via fixed-point refinement
 * - Hardens against the rare Intl "hour=24" edge case
 */

export type IanaTimeZone = string

export function isValidIanaTimeZone(tz: string | null | undefined) {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function sanitizeTimeZone(tz: unknown, fallback = 'UTC') {
  const s = typeof tz === 'string' ? tz.trim() : ''
  return isValidIanaTimeZone(s) ? s : fallback
}

function addDaysToYMD(year: number, month: number, day: number, daysToAdd: number) {
  // Anchor at noon UTC to avoid DST weirdness while rolling dates
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0, 0))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/**
 * Convert a UTC instant into wall-clock parts in `timeZone`.
 *
 * IMPORTANT:
 * Some engines can return hour "24" at midnight (24:00).
 * When that happens, we treat it as 00:00 of the *next* day.
 */
export function getZonedParts(dateUtc: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')

  // Force 24-hour cycle via locale extension.
  // This avoids some "24" weirdness, but we still harden below.
  const dtf = new Intl.DateTimeFormat('en-US-u-hc-h23', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = dtf.formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value

  let year = Number(map.year)
  let month = Number(map.month)
  let day = Number(map.day)
  let hour = Number(map.hour)
  const minute = Number(map.minute)
  const second = Number(map.second)

  // Harden: normalize rare hour=24
  // If Intl says "24:00", that is midnight of the next day.
  if (hour === 24) {
    hour = 0
    const next = addDaysToYMD(year, month, day, 1)
    year = next.year
    month = next.month
    day = next.day
  }

  return { year, month, day, hour, minute, second }
}

/**
 * Offset in minutes such that:
 *   UTC = localAsUTC + offsetMinutes
 *
 * Example: America/Los_Angeles (UTC-8 in winter)
 *   local 00:00 -> UTC 08:00, offset = +480
 */
export function timeZoneOffsetMinutes(atUtc: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(atUtc, tz)

  // Interpret the *local wall clock* as if it were UTC:
  const localAsIfUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)

  // offset = UTC - localAsIfUtc
  const offsetMs = atUtc.getTime() - localAsIfUtcMs
  return Math.round(offsetMs / 60_000)
}

/**
 * Convert a wall-clock datetime in timeZone => UTC Date instant.
 * Uses fixed-point refinement to handle DST jumps.
 */
export function zonedTimeToUtc(args: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second?: number
  timeZone: string
}) {
  const tz = sanitizeTimeZone(args.timeZone, 'UTC')
  const second = args.second ?? 0

  // local interpreted as UTC
  const localAsIfUtcMs = Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute, second)

  // Iterate because offset depends on the final UTC instant (DST)
  let guessUtcMs = localAsIfUtcMs
  for (let i = 0; i < 6; i++) {
    const off = timeZoneOffsetMinutes(new Date(guessUtcMs), tz)
    const correctedUtcMs = localAsIfUtcMs + off * 60_000
    if (Math.abs(correctedUtcMs - guessUtcMs) < 500) return new Date(correctedUtcMs)
    guessUtcMs = correctedUtcMs
  }

  return new Date(guessUtcMs)
}

/**
 * Start of day in `timeZone`, returned as UTC instant.
 */
export function startOfDayUtcInTimeZone(dateUtcInstant: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(dateUtcInstant, tz)
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0, timeZone: tz })
}

/**
 * YYYY-MM-DD for a UTC instant as seen in `timeZone`.
 */
export function ymdInTimeZone(dateUtc: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(dateUtc, tz)
  const yyyy = String(p.year).padStart(4, '0')
  const mm = String(p.month).padStart(2, '0')
  const dd = String(p.day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Minutes since midnight in `timeZone` for a UTC instant.
 */
export function minutesSinceMidnightInTimeZone(dateUtc: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(dateUtc, tz)
  return p.hour * 60 + p.minute
}

/**
 * Given a day Date (any instant) and minutes-from-midnight, interpret that day in `timeZone`
 * and return the UTC instant for that wall-clock time.
 */
export function utcFromDayAndMinutesInTimeZone(day: Date, minutesFromMidnight: number, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(day, tz)
  const mins = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutesFromMidnight)))
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: hh, minute: mm, second: 0, timeZone: tz })
}
