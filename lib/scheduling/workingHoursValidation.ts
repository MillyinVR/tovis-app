// lib/scheduling/workingHoursValidation.ts

import { Prisma } from '@prisma/client'

import { isRecord } from '@/lib/guards'
import {
  WEEKDAY_KEYS,
  parseHHMM,
  type WeekdayKey,
  type WorkingHoursDay,
  type WorkingHoursJson,
} from '@/lib/scheduling/workingHours'

export type WorkingHoursObj = NonNullable<WorkingHoursJson>

export const DAYS = WEEKDAY_KEYS

const DEFAULT_START = '09:00'
const DEFAULT_END = '17:00'

const DEFAULT_ENABLED_DAYS: ReadonlySet<WeekdayKey> = new Set<WeekdayKey>([
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
])

const ALLOWED_DAY_KEYS = new Set<string>(DAYS)

function formatHHMM(hh: number, mm: number): string {
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Valid working-hours rules:
 * - enabled must be boolean
 * - start/end must be valid HH:MM
 * - start and end cannot be identical
 * - overnight ranges ARE allowed (e.g. 22:00 -> 02:00)
 *
 * Disabled days still need structurally valid times so the stored object remains predictable.
 */
function normalizeWorkingHoursDay(value: unknown): WorkingHoursDay | null {
  if (!isRecord(value)) return null
  if (typeof value.enabled !== 'boolean') return null

  const start = parseHHMM(value.start)
  const end = parseHHMM(value.end)

  if (!start || !end) return null

  const startMinutes = start.hh * 60 + start.mm
  const endMinutes = end.hh * 60 + end.mm

  // Reject zero-length windows like 09:00 -> 09:00.
  // Overnight windows such as 22:00 -> 02:00 are valid.
  if (startMinutes === endMinutes) return null

  return {
    enabled: value.enabled,
    start: formatHHMM(start.hh, start.mm),
    end: formatHHMM(end.hh, end.mm),
  }
}

export function defaultWorkingHours(): WorkingHoursObj {
  return {
    sun: {
      enabled: DEFAULT_ENABLED_DAYS.has('sun'),
      start: DEFAULT_START,
      end: DEFAULT_END,
    },
    mon: {
      enabled: DEFAULT_ENABLED_DAYS.has('mon'),
      start: DEFAULT_START,
      end: DEFAULT_END,
    },
    tue: {
      enabled: DEFAULT_ENABLED_DAYS.has('tue'),
      start: DEFAULT_START,
      end: DEFAULT_END,
    },
    wed: {
      enabled: DEFAULT_ENABLED_DAYS.has('wed'),
      start: DEFAULT_START,
      end: DEFAULT_END,
    },
    thu: {
      enabled: DEFAULT_ENABLED_DAYS.has('thu'),
      start: DEFAULT_START,
      end: DEFAULT_END,
    },
    fri: {
      enabled: DEFAULT_ENABLED_DAYS.has('fri'),
      start: DEFAULT_START,
      end: DEFAULT_END,
    },
    sat: {
      enabled: DEFAULT_ENABLED_DAYS.has('sat'),
      start: DEFAULT_START,
      end: DEFAULT_END,
    },
  }
}

export function normalizeWorkingHours(value: unknown): WorkingHoursObj | null {
  if (!isRecord(value)) return null

  for (const key of Object.keys(value)) {
    if (!ALLOWED_DAY_KEYS.has(key)) return null
  }

  const sun = normalizeWorkingHoursDay(value.sun)
  const mon = normalizeWorkingHoursDay(value.mon)
  const tue = normalizeWorkingHoursDay(value.tue)
  const wed = normalizeWorkingHoursDay(value.wed)
  const thu = normalizeWorkingHoursDay(value.thu)
  const fri = normalizeWorkingHoursDay(value.fri)
  const sat = normalizeWorkingHoursDay(value.sat)

  if (!sun || !mon || !tue || !wed || !thu || !fri || !sat) {
    return null
  }

  return {
    sun,
    mon,
    tue,
    wed,
    thu,
    fri,
    sat,
  }
}

export function looksLikeWorkingHours(value: unknown): value is WorkingHoursObj {
  return normalizeWorkingHours(value) !== null
}

export function safeHoursFromDb(value: unknown): WorkingHoursObj {
  return normalizeWorkingHours(value) ?? defaultWorkingHours()
}

export function toInputJsonValue(
  value: WorkingHoursObj,
): Prisma.InputJsonValue {
  return {
    sun: {
      enabled: value.sun.enabled,
      start: value.sun.start,
      end: value.sun.end,
    },
    mon: {
      enabled: value.mon.enabled,
      start: value.mon.start,
      end: value.mon.end,
    },
    tue: {
      enabled: value.tue.enabled,
      start: value.tue.start,
      end: value.tue.end,
    },
    wed: {
      enabled: value.wed.enabled,
      start: value.wed.start,
      end: value.wed.end,
    },
    thu: {
      enabled: value.thu.enabled,
      start: value.thu.start,
      end: value.thu.end,
    },
    fri: {
      enabled: value.fri.enabled,
      start: value.fri.start,
      end: value.fri.end,
    },
    sat: {
      enabled: value.sat.enabled,
      start: value.sat.start,
      end: value.sat.end,
    },
  }
}