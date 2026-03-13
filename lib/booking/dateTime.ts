// lib/booking/dateTime.ts
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'

type DateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const DATETIME_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

function assertValidTimeZone(timeZone: string): string {
  const tz = sanitizeTimeZone(timeZone, '')
  if (!tz || !isValidIanaTimeZone(tz)) {
    throw new Error(`Invalid IANA timezone: ${String(timeZone)}`)
  }
  return tz
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) {
    throw new Error(`Invalid date. Expected YYYY-MM-DD, received: ${ymd}`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid date components in: ${ymd}`)
  }

  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${ymd}`)
  }

  return { year, month, day }
}

function parseDateTimeLocal(value: string): DateParts {
  const match = DATETIME_LOCAL_RE.exec(value)
  if (!match) {
    throw new Error(
      `Invalid datetime-local value. Expected YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss, received: ${value}`
    )
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = match[6] ? Number(match[6]) : 0

  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date in datetime-local value: ${value}`)
  }

  if (hour < 0 || hour > 23) {
    throw new Error(`Invalid hour in datetime-local value: ${value}`)
  }
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute in datetime-local value: ${value}`)
  }
  if (second < 0 || second > 59) {
    throw new Error(`Invalid second in datetime-local value: ${value}`)
  }

  return { year, month, day, hour, minute, second }
}

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function normalizeHour24(parts: DateParts): DateParts {
  if (parts.hour !== 24) return parts

  // Defensive normalization. With hourCycle:'h23' this should not normally happen,
  // but if an environment still emits 24, treat it as 00 on the same formatted day.
  return {
    ...parts,
    hour: 0,
  }
}

function getDatePartsInTimeZone(date: Date, timeZone: string): DateParts {
  const tz = assertValidTimeZone(timeZone)
  const formatter = getFormatter(tz)
  const parts = formatter.formatToParts(date)

  const map = new Map<string, string>()
  for (const part of parts) {
    if (part.type !== 'literal') {
      map.set(part.type, part.value)
    }
  }

  const year = Number(map.get('year'))
  const month = Number(map.get('month'))
  const day = Number(map.get('day'))
  const hour = Number(map.get('hour'))
  const minute = Number(map.get('minute'))
  const second = Number(map.get('second'))

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    throw new Error(`Failed to read date parts for timezone ${tz}`)
  }

  return normalizeHour24({ year, month, day, hour, minute, second })
}

/**
 * Returns the timezone offset, in milliseconds, for the provided UTC instant
 * as observed in the target timezone.
 *
 * Positive means timezone is ahead of UTC.
 */
function getTimeZoneOffsetMs(utcDate: Date, timeZone: string): number {
  const parts = getDatePartsInTimeZone(utcDate, timeZone)
  const asUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  )
  return asUtcMs - utcDate.getTime()
}

function sameParts(a: DateParts, b: DateParts): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  )
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values))
}

/**
 * Convert local wall-clock parts in a timezone into a UTC Date.
 *
 * Rules:
 * - unique exact mapping => return it
 * - nonexistent wall time => throw
 * - ambiguous wall time (fall-back repeated hour) => throw
 */
function localPartsToUtcDate(parts: DateParts, timeZone: string): Date {
  const tz = assertValidTimeZone(timeZone)

  // Treat the local wall time as if it were UTC. This gives us a stable anchor.
  const naiveUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  )

  // Probe several nearby instants to collect plausible offsets.
  // This is much more reliable than a single/two-pass guess around DST edges.
  const probeInstants = [
    naiveUtcMs - 36 * 60 * 60_000,
    naiveUtcMs - 24 * 60 * 60_000,
    naiveUtcMs - 12 * 60 * 60_000,
    naiveUtcMs - 6 * 60 * 60_000,
    naiveUtcMs,
    naiveUtcMs + 6 * 60 * 60_000,
    naiveUtcMs + 12 * 60 * 60_000,
    naiveUtcMs + 24 * 60 * 60_000,
    naiveUtcMs + 36 * 60 * 60_000,
  ]

  const candidateMs = uniqueNumbers(
    probeInstants.map((probeMs) => {
      const offsetMs = getTimeZoneOffsetMs(new Date(probeMs), tz)
      return naiveUtcMs - offsetMs
    })
  )

  const exactMatches = candidateMs.filter((ms) => {
    const actual = getDatePartsInTimeZone(new Date(ms), tz)
    return sameParts(actual, parts)
  })

  if (exactMatches.length !== 1) {
    throw new Error(
      `Local wall time does not exist or is ambiguous in timezone ${tz}: ` +
        `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`
    )
  }

  return new Date(exactMatches[0])
}

function addDaysToYmd(ymd: string, days: number): string {
  const { year, month, day } = parseYmd(ymd)
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return [
    d.getUTCFullYear(),
    pad2(d.getUTCMonth() + 1),
    pad2(d.getUTCDate()),
  ].join('-')
}

export function formatDateTimeLocalParts(parts: DateParts, includeSeconds = false): string {
  const base = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`
  return includeSeconds ? `${base}:${pad2(parts.second)}` : base
}

/**
 * Convert a UTC Date into a datetime-local string for a specific timezone.
 * Output is safe for <input type="datetime-local">.
 */
export function utcDateToDateTimeLocal(date: Date, timeZone: string, includeSeconds = false): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('utcDateToDateTimeLocal requires a valid Date')
  }
  const parts = getDatePartsInTimeZone(date, timeZone)
  return formatDateTimeLocalParts(parts, includeSeconds)
}

/**
 * Convert a UTC ISO string into a datetime-local string for a specific timezone.
 */
export function utcIsoToDateTimeLocal(iso: string, timeZone: string, includeSeconds = false): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO datetime: ${iso}`)
  }
  return utcDateToDateTimeLocal(date, timeZone, includeSeconds)
}

/**
 * Convert a datetime-local string interpreted in the provided timezone into a UTC Date.
 *
 * Throws if the local wall time is invalid, nonexistent, or ambiguous for that timezone.
 */
export function dateTimeLocalToUtcDate(value: string, timeZone: string): Date {
  const parts = parseDateTimeLocal(value)
  return localPartsToUtcDate(parts, timeZone)
}

/**
 * Convert a datetime-local string interpreted in the provided timezone into a UTC ISO string.
 */
export function dateTimeLocalToUtcIso(value: string, timeZone: string): string {
  return dateTimeLocalToUtcDate(value, timeZone).toISOString()
}

/**
 * Convert a local calendar date in the provided timezone into UTC start/end bounds.
 *
 * start = local YYYY-MM-DD 00:00:00
 * end   = next local day 00:00:00
 *
 * Use end as exclusive: [start, end)
 */
export function getUtcBoundsForLocalDate(
  ymd: string,
  timeZone: string
): { startUtc: Date; endUtc: Date } {
  parseYmd(ymd)
  const nextYmd = addDaysToYmd(ymd, 1)

  const startUtc = localPartsToUtcDate(
    {
      ...parseYmd(ymd),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone
  )

  const endUtc = localPartsToUtcDate(
    {
      ...parseYmd(nextYmd),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone
  )

  return { startUtc, endUtc }
}

/**
 * Same as getUtcBoundsForLocalDate, but returns ISO strings.
 */
export function getUtcIsoBoundsForLocalDate(
  ymd: string,
  timeZone: string
): { startUtcIso: string; endUtcIso: string } {
  const { startUtc, endUtc } = getUtcBoundsForLocalDate(ymd, timeZone)
  return {
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString(),
  }
}

/**
 * Returns the local YYYY-MM-DD for a UTC instant in the provided timezone.
 */
export function utcDateToLocalYmd(date: Date, timeZone: string): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('utcDateToLocalYmd requires a valid Date')
  }
  const parts = getDatePartsInTimeZone(date, timeZone)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

/**
 * Returns the local YYYY-MM-DD for a UTC ISO instant in the provided timezone.
 */
export function utcIsoToLocalYmd(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO datetime: ${iso}`)
  }
  return utcDateToLocalYmd(date, timeZone)
}

/**
 * Returns local wall-clock parts for a UTC instant in a timezone.
 * Useful when you need day/hour/minute comparisons without inventing local Date objects.
 */
export function utcDateToLocalParts(date: Date, timeZone: string): DateParts {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('utcDateToLocalParts requires a valid Date')
  }
  return getDatePartsInTimeZone(date, timeZone)
}