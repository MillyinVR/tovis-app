// lib/timeZone.ts
/**
 * Single source of truth for timezone ops across the app.
 * - Intl-only (no deps)
 * - Handles DST via fixed-point refinement
 * - Hardens against the rare Intl "hour=24" edge case
 *
 * IMPORTANT APP POLICY:
 * - Never default to America/Los_Angeles implicitly.
 * - Use UTC for safe fallbacks unless you explicitly have a better source of truth.
 */

export type IanaTimeZone = string

/** Default fallback when a timezone is missing/invalid. */
export const DEFAULT_TIME_ZONE: IanaTimeZone = 'UTC'

// An `Intl.DateTimeFormat` is a small JS wrapper over a ~31KB native ICU
// object. V8 only sees the wrapper, so a formatter built per call in a hot path
// applies no heap pressure, is never collected, and RSS climbs into the
// gigabytes while heapUsed stays flat. `sanitizeTimeZone` runs on the first
// line of `getZonedParts` (slot generation), so building a throwaway validation
// formatter per call defeated the ZONED_PARTS_FORMATTER_CACHE below and drove
// the e2e server to ~14GB. Cache the verdict per zone string instead.
//
// Bounded: valid IANA ids are a finite set, but invalid inputs reach here from
// caller-supplied data, so cap the map rather than let it grow without limit.
const TIME_ZONE_VALIDITY_CACHE = new Map<string, boolean>()
const TIME_ZONE_VALIDITY_CACHE_MAX = 512

export function isValidIanaTimeZone(tz: string | null | undefined) {
  if (!tz || typeof tz !== 'string') return false

  const cached = TIME_ZONE_VALIDITY_CACHE.get(tz)
  if (cached !== undefined) return cached

  let valid: boolean
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    valid = true
  } catch {
    valid = false
  }

  if (TIME_ZONE_VALIDITY_CACHE.size < TIME_ZONE_VALIDITY_CACHE_MAX) {
    TIME_ZONE_VALIDITY_CACHE.set(tz, valid)
  }

  return valid
}

/**
 * Returns a valid IANA timezone string.
 * If invalid, returns the provided fallback (defaults to UTC).
 */
export function sanitizeTimeZone(tz: unknown, fallback: IanaTimeZone = DEFAULT_TIME_ZONE): IanaTimeZone {
  const s = typeof tz === 'string' ? tz.trim() : ''
  return isValidIanaTimeZone(s) ? (s as IanaTimeZone) : fallback
}

/**
 * Returns a valid IANA timezone string OR null.
 * Use this when you want the UI to hide timezone rather than invent one.
 */
export function pickTimeZoneOrNull(tz: unknown): IanaTimeZone | null {
  const s = typeof tz === 'string' ? tz.trim() : ''
  return isValidIanaTimeZone(s) ? (s as IanaTimeZone) : null
}

/**
 * Human-friendly timezone label for UI, e.g. "Central Time", "Pacific Time".
 *
 * Uses Intl `longGeneric` naming, which is DST-agnostic (no "CDT vs CST"
 * flapping). Prefer this over rendering the raw IANA id (`America/Chicago`)
 * anywhere a person will read it.
 *
 * Returns `null` for missing/invalid input so callers can hide the label
 * instead of inventing one. Pass an invalid `tz` through and you get `null`;
 * if Intl can't produce a name, falls back to the sanitized IANA id.
 */
export function friendlyTimeZoneLabel(tz: unknown): string | null {
  const zone = pickTimeZoneOrNull(tz)
  if (!zone) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longGeneric',
    }).formatToParts(new Date())
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    return name && name.trim() ? name : zone
  } catch {
    return zone
  }
}

/**
 * Step a calendar date by whole days. The single home for this primitive — it
 * is DST-critical (a "next day" anchored to a local midnight must step
 * calendar days, never +24h of milliseconds), and it existed twice for a while
 * (here and in availability/core/summaryWindow.ts, identical by luck rather
 * than by construction). Anchoring at noon UTC keeps Date.UTC's day-rollover
 * arithmetic away from any midnight boundary.
 */
export function addDaysToYMD(
  year: number,
  month: number,
  day: number,
  daysToAdd: number,
): { year: number; month: number; day: number } {
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
// Intl.DateTimeFormat construction is relatively expensive, and getZonedParts
// runs in hot paths (slot generation, quiet-hours checks). The formatter config
// is fixed, so memoize one per sanitized timezone — this lets perf-sensitive
// callers use getZonedParts directly instead of hand-rolling their own caches.
const ZONED_PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function getZonedPartsFormatter(tz: string): Intl.DateTimeFormat {
  const cached = ZONED_PARTS_FORMATTER_CACHE.get(tz)
  if (cached) return cached

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

  ZONED_PARTS_FORMATTER_CACHE.set(tz, dtf)
  return dtf
}

export function getZonedParts(dateUtc: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)

  const parts = getZonedPartsFormatter(tz).formatToParts(dateUtc)
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
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
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
 *
 * BEST-EFFORT: at a DST gap or fall-back overlap this silently picks one
 * instant rather than reporting the problem. Use it for day-boundary / range /
 * navigation math whose input is always midnight (never in a gap). For a time a
 * human explicitly picks (appointment, calendar block), use the strict
 * `zonedPartsToUtcStrict` (lib/booking/dateTime) / `partsToUtcIsoStrict`
 * (lib/bookingTime), which reject nonexistent/ambiguous times so the UI can
 * prompt for another.
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
  const tz = sanitizeTimeZone(args.timeZone, DEFAULT_TIME_ZONE)
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
 *
 * `dayOffset` moves whole LOCAL days — `1` is the next local midnight, not
 * "+24h". Those differ: across a DST transition a local day is 23 or 25 hours
 * long, so `startOfDay + 86_400_000` lands at 01:00 (spring) or 23:00 the same
 * day (autumn). Day arithmetic runs on the calendar parts, which cannot drift.
 */
export function startOfDayUtcInTimeZone(
  dateUtcInstant: Date,
  timeZone: string,
  dayOffset = 0,
) {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  const p = getZonedParts(dateUtcInstant, tz)
  const { year, month, day } = dayOffset
    ? addDaysToYMD(p.year, p.month, p.day, dayOffset)
    : p
  return zonedTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0, timeZone: tz })
}

/**
 * YYYY-MM-DD for a UTC instant as seen in `timeZone`.
 */
export function ymdInTimeZone(dateUtc: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
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
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  const p = getZonedParts(dateUtc, tz)
  return p.hour * 60 + p.minute
}

/**
 * Ordinal local-day number for a UTC instant as seen in `timeZone`, counted in
 * whole days from the epoch. Only differences between two serials are
 * meaningful; the absolute value is an implementation detail.
 *
 * The zoned Y/M/D is re-anchored at 12:00 UTC on purpose: midday is far enough
 * from either boundary that no DST shift (±1h, historically up to ±2h) can push
 * the reconstructed instant into an adjacent day, so `Math.floor` never lands a
 * local date on the wrong serial.
 */
export function daySerialInTimeZone(dateUtc: Date, timeZone: string): number {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  const p = getZonedParts(dateUtc, tz)

  return Math.floor(
    Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0, 0) / 86_400_000,
  )
}

/**
 * Day of week (0 = Sunday … 6 = Saturday) for a UTC instant as seen in
 * `timeZone`. Derived from the timezone-resolved Y/M/D parts so it never drifts
 * into the server's zone — the single source of truth for "which weekday is
 * this appointment", replacing scattered `new Intl.DateTimeFormat(... weekday)`
 * + string-switch lookups.
 */
export function weekdayInTimeZone(dateUtc: Date, timeZone: string): number {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  const p = getZonedParts(dateUtc, tz)
  // Build the date at UTC midnight from the already-zoned parts; getUTCDay then
  // yields the weekday without any further timezone interpretation.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

/**
 * Given a day Date (any instant) and minutes-from-midnight, interpret that day in `timeZone`
 * and return the UTC instant for that wall-clock time.
 */
export function utcFromDayAndMinutesInTimeZone(day: Date, minutesFromMidnight: number, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  const p = getZonedParts(day, tz)
  const mins = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutesFromMidnight)))
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: hh, minute: mm, second: 0, timeZone: tz })
}
