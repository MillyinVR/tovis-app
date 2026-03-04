// lib/scheduling/workingHours.ts
import { isRecord } from '@/lib/guards'
import { sanitizeTimeZone } from '@/lib/timeZone'

export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export type WorkingHoursDay = { enabled: boolean; start: string; end: string }
export type WorkingHoursJson = Record<WeekdayKey, WorkingHoursDay> | null

export const WEEKDAY_KEYS: readonly WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function hhmmToMinutes(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null

  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null

  return hh * 60 + mm
}

function weekdayKeyForDate(day: Date, timeZone: string): WeekdayKey | null {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const short = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(day)
  const map: Record<string, WeekdayKey> = {
    Sun: 'sun',
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
  }
  return map[short] ?? null
}

export function getWorkingWindowForDay(
  day: Date,
  workingHours: unknown,
  timeZone: string,
): { key: WeekdayKey; startMinutes: number; endMinutes: number } | null {
  if (!isRecord(workingHours)) return null

  const key = weekdayKeyForDate(day, timeZone)
  if (!key) return null

  const cfgUnknown = workingHours[key]
  if (!isRecord(cfgUnknown)) return null

  const enabled = cfgUnknown.enabled
  if (typeof enabled !== 'boolean' || !enabled) return null

  const startMinutes = hhmmToMinutes(cfgUnknown.start)
  const endMinutes = hhmmToMinutes(cfgUnknown.end)
  if (startMinutes == null || endMinutes == null) return null
  if (endMinutes <= startMinutes) return null

  return { key, startMinutes, endMinutes }
}

export function isOutsideWorkingHours(args: {
  day: Date
  startMinutes: number
  endMinutes: number
  workingHours: unknown
  timeZone: string
}): boolean {
  const window = getWorkingWindowForDay(args.day, args.workingHours, args.timeZone)
  if (!window) return true
  return args.startMinutes < window.startMinutes || args.endMinutes > window.endMinutes
}