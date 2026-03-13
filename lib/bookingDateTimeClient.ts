// lib/bookingDateTimeClient.ts
import {
  dateTimeLocalToUtcIso as sharedDateTimeLocalToUtcIso,
  utcIsoToDateTimeLocal,
} from '@/lib/booking/dateTime'

export function utcIsoToDateInputValue(iso: string, timeZone: string): string {
  const local = utcIsoToDateTimeLocal(iso, timeZone)
  return local.slice(0, 10)
}

export function utcIsoToTimeInputValue(iso: string, timeZone: string): string {
  const local = utcIsoToDateTimeLocal(iso, timeZone)
  return local.slice(11, 16)
}

export function combineDateAndTimeInput(date: string, time: string): string {
  const d = date.trim()
  const t = time.trim()
  if (!d || !t) {
    throw new Error('Missing date or time.')
  }
  return `${d}T${t}:00`
}

export function dateTimeLocalToUtcIso(value: string, timeZone: string): string {
  return sharedDateTimeLocalToUtcIso(value, timeZone)
}

export function formatUtcInAppointmentTz(
  iso: string,
  timeZone: string,
  locale?: string,
): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''

  return date.toLocaleString(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatUtcInViewerTz(
  iso: string,
  viewerTimeZone: string,
  locale?: string,
): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''

  return date.toLocaleString(locale, {
    timeZone: viewerTimeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}