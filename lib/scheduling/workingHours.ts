// lib/scheduling/workingHours.ts

import { isRecord } from '@/lib/guards'
import {
  getZonedParts,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'

export type WeekdayKey =
  | 'sun'
  | 'mon'
  | 'tue'
  | 'wed'
  | 'thu'
  | 'fri'
  | 'sat'

export type WorkingHoursDay = {
  enabled: boolean
  start: string
  end: string
}

export type WorkingHoursJson = Record<WeekdayKey, WorkingHoursDay> | null

export const WEEKDAY_KEYS: readonly WeekdayKey[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const

const WEEKDAY_SHORT_TO_KEY: Record<string, WeekdayKey> = {
  Sun: 'sun',
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
}

export type ParsedHHMM = {
  hh: number
  mm: number
}

export type WorkingWindowResult =
  | { ok: true; key: WeekdayKey; startMinutes: number; endMinutes: number }
  | { ok: false; reason: 'MISSING' | 'DISABLED' | 'MISCONFIGURED' }

export type WorkingHoursRangeCheckResult =
  | { ok: true; key: WeekdayKey; startMinutes: number; endMinutes: number }
  | {
      ok: false
      reason:
        | 'MISSING'
        | 'DISABLED'
        | 'MISCONFIGURED'
        | 'CROSS_DAY'
        | 'OUTSIDE'
    }

/**
 * Strict HH:MM only.
 * Accepts:
 * - 09:00
 * - 17:30
 *
 * Rejects:
 * - 9:00
 * - 9:0
 * - 24:00
 * - garbage
 */
export function parseHHMM(v: unknown): ParsedHHMM | null {
  if (typeof v !== 'string') return null

  const s = v.trim()
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null

  const hh = Number(m[1])
  const mm = Number(m[2])

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23) return null
  if (mm < 0 || mm > 59) return null

  return { hh, mm }
}

/**
 * Strict HH:MM -> minutes from midnight
 */
export function hhmmToMinutes(v: unknown): number | null {
  const parsed = parseHHMM(v)
  if (!parsed) return null
  return parsed.hh * 60 + parsed.mm
}

/**
 * Minutes from midnight -> HH:MM
 */
export function minutesToHHMM(minutes: number): string | null {
  if (!Number.isFinite(minutes)) return null

  const whole = Math.trunc(minutes)
  if (whole < 0 || whole > 23 * 60 + 59) return null

  const hh = Math.floor(whole / 60)
  const mm = whole % 60

  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function weekdayKeyForDate(day: Date, timeZone: string): WeekdayKey | null {
  const tz = sanitizeTimeZone(timeZone, 'UTC')

  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).format(day)

  return WEEKDAY_SHORT_TO_KEY[short] ?? null
}

/**
 * Shared source of truth for reading the working-hours window for a day.
 */
export function getWorkingWindowForDay(
  day: Date,
  workingHours: unknown,
  timeZone: string,
): WorkingWindowResult {
  if (!isRecord(workingHours)) {
    return { ok: false, reason: 'MISSING' }
  }

  const key = weekdayKeyForDate(day, timeZone)
  if (!key) {
    return { ok: false, reason: 'MISCONFIGURED' }
  }

  const cfgUnknown = workingHours[key]
  if (!isRecord(cfgUnknown)) {
    return { ok: false, reason: 'MISCONFIGURED' }
  }

  if (typeof cfgUnknown.enabled !== 'boolean') {
    return { ok: false, reason: 'MISCONFIGURED' }
  }

  if (cfgUnknown.enabled === false) {
    return { ok: false, reason: 'DISABLED' }
  }

  const startMinutes = hhmmToMinutes(cfgUnknown.start)
  const endMinutes = hhmmToMinutes(cfgUnknown.end)

  if (startMinutes == null || endMinutes == null) {
    return { ok: false, reason: 'MISCONFIGURED' }
  }

  if (endMinutes <= startMinutes) {
    return { ok: false, reason: 'MISCONFIGURED' }
  }

  return {
    ok: true,
    key,
    startMinutes,
    endMinutes,
  }
}

export function isOutsideWorkingHours(args: {
  day: Date
  startMinutes: number
  endMinutes: number
  workingHours: unknown
  timeZone: string
}): boolean {
  const window = getWorkingWindowForDay(
    args.day,
    args.workingHours,
    args.timeZone,
  )

  if (!window.ok) return true

  return (
    args.startMinutes < window.startMinutes ||
    args.endMinutes > window.endMinutes
  )
}

/**
 * Shared booking/span validation:
 * - workingHours must exist and be well-formed
 * - start/end must land on the same local day
 * - requested span must fit inside that day's working window
 *
 * Routes can map the result reason to user-facing copy.
 */
export function checkWorkingHoursRange(args: {
  scheduledStartUtc: Date
  scheduledEndUtc: Date
  workingHours: unknown
  timeZone: string
}): WorkingHoursRangeCheckResult {
  const {
    scheduledStartUtc,
    scheduledEndUtc,
    workingHours,
    timeZone,
  } = args

  if (!isRecord(workingHours)) {
    return { ok: false, reason: 'MISSING' }
  }

  const tz = sanitizeTimeZone(timeZone, 'UTC')

  const startParts = getZonedParts(scheduledStartUtc, tz)
  const endParts = getZonedParts(scheduledEndUtc, tz)

  const sameLocalDay =
    startParts.year === endParts.year &&
    startParts.month === endParts.month &&
    startParts.day === endParts.day

  if (!sameLocalDay) {
    return { ok: false, reason: 'CROSS_DAY' }
  }

  const window = getWorkingWindowForDay(scheduledStartUtc, workingHours, tz)
  if (!window.ok) {
    return window
  }

  const startMinutes = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMinutes = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

  if (
    startMinutes < window.startMinutes ||
    endMinutes > window.endMinutes
  ) {
    return { ok: false, reason: 'OUTSIDE' }
  }

  return {
    ok: true,
    key: window.key,
    startMinutes: window.startMinutes,
    endMinutes: window.endMinutes,
  }
}