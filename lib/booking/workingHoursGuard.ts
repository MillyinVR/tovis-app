// lib/booking/workingHoursGuard.ts

import { getZonedParts, sanitizeTimeZone } from '@/lib/timeZone'
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

function localMinutesSinceMidnight(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone)
  return parts.hour * 60 + parts.minute
}

function localDaySerial(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone)
  return Math.floor(
    Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0) / 86_400_000,
  )
}

function offsetFromWindowStartDay(args: {
  targetUtc: Date
  windowDayUtc: Date
  timeZone: string
}): number {
  const { targetUtc, windowDayUtc, timeZone } = args

  const dayDelta =
    localDaySerial(targetUtc, timeZone) - localDaySerial(windowDayUtc, timeZone)

  return dayDelta * 1440 + localMinutesSinceMidnight(targetUtc, timeZone)
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

  const startOffset = offsetFromWindowStartDay({
    targetUtc: scheduledStartUtc,
    windowDayUtc: scheduledStartUtc,
    timeZone: tz,
  })

  const endOffset = offsetFromWindowStartDay({
    targetUtc: scheduledEndUtc,
    windowDayUtc: scheduledStartUtc,
    timeZone: tz,
  })

  if (
    endOffset <= startOffset ||
    startOffset < window.startMinutes ||
    endOffset > window.endMinutes
  ) {
    return { ok: false, error: text.outside }
  }

  return { ok: true, timeZone: tz }
}