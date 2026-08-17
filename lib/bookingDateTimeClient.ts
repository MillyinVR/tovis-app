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
