// lib/booking/workingHoursGuard.ts 

import {
  getZonedParts,
  minutesSinceMidnightInTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'

export type WorkingHoursGuardMessages = {
  missing?: string
  outside?: string
  misconfigured?: string
}

export type EnsureWithinWorkingHoursArgs = {
  scheduledStartUtc: Date
  scheduledEndUtc: Date
  workingHours: unknown
  timeZone: string
  fallbackTimeZone?: string
  messages?: WorkingHoursGuardMessages
}

export type EnsureWithinWorkingHoursResult =
  | { ok: true; timeZone: string }
  | { ok: false; error: string }

const DEFAULT_MESSAGES: Required<WorkingHoursGuardMessages> = {
  missing: 'Working hours are not set yet.',
  outside: 'That time is outside working hours.',
  misconfigured: 'Working hours are misconfigured.',
}

export function ensureWithinWorkingHours(
  args: EnsureWithinWorkingHoursArgs,
): EnsureWithinWorkingHoursResult {
  const {
    scheduledStartUtc,
    scheduledEndUtc,
    workingHours,
    timeZone,
    fallbackTimeZone = 'UTC',
    messages,
  } = args

  const text = {
    ...DEFAULT_MESSAGES,
    ...messages,
  }

  const tz = sanitizeTimeZone(timeZone, fallbackTimeZone)

  const startParts = getZonedParts(scheduledStartUtc, tz)
  const endParts = getZonedParts(scheduledEndUtc, tz)

  const sameLocalDay =
    startParts.year === endParts.year &&
    startParts.month === endParts.month &&
    startParts.day === endParts.day

  if (!sameLocalDay) {
    return { ok: false, error: text.outside }
  }

  const window = getWorkingWindowForDay(scheduledStartUtc, workingHours, tz)

  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return { ok: false, error: text.missing }
    }

    if (window.reason === 'DISABLED') {
      return { ok: false, error: text.outside }
    }

    return { ok: false, error: text.misconfigured }
  }

  const startMinutes = minutesSinceMidnightInTimeZone(scheduledStartUtc, tz)
  const endMinutes = minutesSinceMidnightInTimeZone(scheduledEndUtc, tz)

  if (
    startMinutes < window.startMinutes ||
    endMinutes > window.endMinutes
  ) {
    return { ok: false, error: text.outside }
  }

  return { ok: true, timeZone: tz }
}