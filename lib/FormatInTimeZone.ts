// lib/FormatInTimeZone.ts
import { sanitizeTimeZone } from '@/lib/timeZone'

type DateLike = Date | string | number

function toDate(v: DateLike): Date | null {
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatInTimeZone(
  date: DateLike,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
) {
  const d = toDate(date)
  if (!d) return 'Invalid date'

  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }).format(d)
}

/**
 * Handy “appointment time” formatter used across SMS + UI.
 */
export function formatAppointmentWhen(
  date: DateLike,
  timeZone: string,
  locale?: string,
) {
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

export function formatRangeInTimeZone(
  start: DateLike,
  end: DateLike,
  timeZone: string,
  locale?: string,
) {
  const s = toDate(start)
  const e = toDate(end)
  if (!s || !e) return 'Invalid range'

  const tz = sanitizeTimeZone(timeZone, 'UTC')

  const left = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(s)

  const right = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  }).format(e)

  return `${left} → ${right}`
}
