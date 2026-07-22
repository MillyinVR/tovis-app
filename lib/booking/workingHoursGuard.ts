// lib/booking/workingHoursGuard.ts

import { sanitizeTimeZone } from '@/lib/time'
import {
  getWorkingWindowForDay,
  offsetFromWindowStartDay,
} from '@/lib/scheduling/workingHours'

/**
 * `ensureWithinWorkingHours` returns a plain string, so callers that need to
 * recover WHICH working-hours rule failed pass these sentinels in as the
 * `messages` and decode them on the way back out.
 *
 * This is a wire protocol between one producer and several consumers, so the
 * prefix, the code union, the encoder and both decoders live together here.
 * They used to be re-declared in six files; a prefix that agreed in five of
 * them and not the sixth would silently downgrade a specific refusal to
 * generic copy, which is invisible from the passing side.
 */
export const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

export const WORKING_HOURS_FALLBACK_MESSAGE =
  'That time is outside working hours.'

export type WorkingHoursGuardCode =
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'OUTSIDE_WORKING_HOURS'

const WORKING_HOURS_GUARD_CODES = new Set<string>([
  'WORKING_HOURS_REQUIRED',
  'WORKING_HOURS_INVALID',
  'OUTSIDE_WORKING_HOURS',
])

/**
 * Narrows a wider code union (e.g. `SlotReadinessCode`) to the working-hours
 * subset, so a caller can both TEST and ENCODE from one membership check
 * instead of keeping its own copy of the triple next to a `Set.has` that
 * narrows nothing.
 */
export function isWorkingHoursGuardCode(
  value: string,
): value is WorkingHoursGuardCode {
  return WORKING_HOURS_GUARD_CODES.has(value)
}

export function makeWorkingHoursGuardMessage(
  code: WorkingHoursGuardCode,
): string {
  return `${WORKING_HOURS_ERROR_PREFIX}${code}`
}

export function parseWorkingHoursGuardMessage(
  value: string,
): WorkingHoursGuardCode | null {
  if (!value.startsWith(WORKING_HOURS_ERROR_PREFIX)) return null

  const code = value.slice(WORKING_HOURS_ERROR_PREFIX.length)

  switch (code) {
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'OUTSIDE_WORKING_HOURS':
      return 'OUTSIDE_WORKING_HOURS'
    default:
      return null
  }
}

/**
 * Copy for a human. A sentinel is an internal code and must never reach a
 * client, so it collapses to the fallback; anything else is already human copy
 * and passes through unchanged.
 */
export function getReadableWorkingHoursMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return WORKING_HOURS_FALLBACK_MESSAGE
  }

  if (value.startsWith(WORKING_HOURS_ERROR_PREFIX)) {
    return WORKING_HOURS_FALLBACK_MESSAGE
  }

  return value
}

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
  outside: WORKING_HOURS_FALLBACK_MESSAGE,
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