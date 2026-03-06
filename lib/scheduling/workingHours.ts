import { isRecord } from '@/lib/guards'
import { sanitizeTimeZone } from '@/lib/timeZone'

export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

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

export type ParsedHHMM = {
  hh: number
  mm: number
}

export type WorkingWindowResult =
  | { ok: true; key: WeekdayKey; startMinutes: number; endMinutes: number }
  | { ok: false; reason: 'MISSING' | 'DISABLED' | 'MISCONFIGURED' }

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

  if (cfgUnknown.enabled === false) {
    return { ok: false, reason: 'DISABLED' }
  }

  if (typeof cfgUnknown.enabled !== 'boolean') {
    return { ok: false, reason: 'MISCONFIGURED' }
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
  const window = getWorkingWindowForDay(args.day, args.workingHours, args.timeZone)
  if (!window.ok) return true

  return args.startMinutes < window.startMinutes || args.endMinutes > window.endMinutes
}