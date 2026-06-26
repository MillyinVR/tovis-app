// lib/formatInTimeZone.ts
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'

type DateLike = Date | string | number

function toDate(v: DateLike): Date | null {
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

// Intl.DateTimeFormat construction is comparatively expensive and these
// formatters run per-slot/per-row in hot render and notification paths. The
// option sets are drawn from a small fixed vocabulary, so memoize one formatter
// per (locale, sanitized timeZone, options) — replacing the bespoke formatter
// caches that callers used to keep. The key is built from sorted option entries
// so it's independent of property insertion order.
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function stableOptionsKey(options: Intl.DateTimeFormatOptions): string {
  return JSON.stringify(
    Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
}

function getDateTimeFormat(
  tz: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${tz}|${stableOptionsKey(options)}`
  const cached = FORMATTER_CACHE.get(key)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: tz })
  FORMATTER_CACHE.set(key, formatter)
  return formatter
}

export function formatInTimeZone(
  date: DateLike,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
) {
  const d = toDate(date)
  if (!d) return 'Invalid date'

  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  return getDateTimeFormat(tz, options, locale).format(d)
}

export function formatAppointmentWhen(date: DateLike, timeZone: string, locale?: string) {
  return formatInTimeZone(
    date,
    timeZone,
    {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
    locale,
  )
}

export function formatRangeInTimeZone(start: DateLike, end: DateLike, timeZone: string, locale?: string) {
  const s = toDate(start)
  const e = toDate(end)
  if (!s || !e) return 'Invalid range'

  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)

  const left = getDateTimeFormat(
    tz,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    locale,
  ).format(s)

  const right = getDateTimeFormat(
    tz,
    { hour: 'numeric', minute: '2-digit' },
    locale,
  ).format(e)

  return `${left} → ${right}`
}
