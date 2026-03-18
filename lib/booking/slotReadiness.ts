// lib/booking/slotReadiness.ts

import { clampInt } from '@/lib/pick'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import {
  MAX_ADVANCE_NOTICE_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_DAYS_AHEAD,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { getWorkingWindowForDay } from '@/lib/scheduling/workingHours'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'
import { normalizeStepMinutes } from '@/lib/booking/locationContext'

export type SlotReadinessCode =
  | 'STEP_MISMATCH'
  | 'ADVANCE_NOTICE_REQUIRED'
  | 'MAX_DAYS_AHEAD_EXCEEDED'
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'OUTSIDE_WORKING_HOURS'
  | 'INVALID_START'
  | 'INVALID_DURATION'
  | 'INVALID_BUFFER'
  | 'INVALID_RANGE'

export type SlotReadinessResult =
  | {
      ok: true
      startUtc: Date
      endUtc: Date
      timeZone: string
      stepMinutes: number
      durationMinutes: number
      bufferMinutes: number
    }
  | {
      ok: false
      code: SlotReadinessCode
      startUtc?: Date
      endUtc?: Date
      timeZone: string
      stepMinutes: number
      durationMinutes: number
      bufferMinutes: number
      meta?: Record<string, unknown>
    }

export type ComputeRequestedEndArgs = {
  startUtc: Date
  durationMinutes: number
  bufferMinutes: number
}

export type StepAlignmentArgs = {
  startUtc: Date
  workingHours: unknown
  timeZone: string
  stepMinutes: number
  fallbackTimeZone?: string
}

export type AdvanceNoticeArgs = {
  startUtc: Date
  nowUtc: Date
  advanceNoticeMinutes: number
}

export type MaxDaysAheadArgs = {
  startUtc: Date
  nowUtc: Date
  maxDaysAhead: number
}

export type CheckSlotReadinessArgs = {
  startUtc: Date
  nowUtc?: Date
  durationMinutes: number
  bufferMinutes: number
  workingHours: unknown
  timeZone: string
  stepMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  fallbackTimeZone?: string
}

const DEFAULT_FALLBACK_TIME_ZONE = 'UTC'

const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

type WorkingHoursGuardCode =
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'OUTSIDE_WORKING_HOURS'

function makeWorkingHoursGuardMessage(code: WorkingHoursGuardCode): string {
  return `${WORKING_HOURS_ERROR_PREFIX}${code}`
}

function parseWorkingHoursGuardMessage(
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

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function normalizeDurationMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return Number.NaN

  return clampInt(Math.trunc(parsed), 15, MAX_SLOT_DURATION_MINUTES)
}

function normalizeBufferMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return Number.NaN

  return clampInt(Math.trunc(parsed), 0, MAX_BUFFER_MINUTES)
}

function normalizeAdvanceNoticeMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0

  return clampInt(Math.trunc(parsed), 0, MAX_ADVANCE_NOTICE_MINUTES)
}

function normalizeMaxDaysAhead(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 1

  return clampInt(Math.trunc(parsed), 1, MAX_DAYS_AHEAD)
}

function localMinutesSinceMidnight(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')

  return hour * 60 + minute
}

function localDaySerial(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0')
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '0')
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '0')

  return Math.floor(
    Date.UTC(year, month - 1, day, 12, 0, 0, 0) / 86_400_000,
  )
}

/**
 * Returns minutes from the local start-day used by getWorkingWindowForDay().
 *
 * Examples:
 * - same local day 01:30 => 90
 * - same local day 23:15 => 1395
 * - next local day 00:30 => 1470
 */
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

export function computeRequestedEndUtc(
  args: ComputeRequestedEndArgs,
): Date {
  const startUtc = normalizeToMinute(new Date(args.startUtc))
  const durationMinutes = normalizeDurationMinutes(args.durationMinutes)
  const bufferMinutes = normalizeBufferMinutes(args.bufferMinutes)

  return addMinutes(startUtc, durationMinutes + bufferMinutes)
}

/**
 * Shared step enforcement rule.
 *
 * IMPORTANT:
 * This is intentionally WORKING-WINDOW aligned, not midnight aligned.
 * That matches availability/day logic and fixes the parity bug where
 * availability showed slots that write paths later rejected.
 */
export function isStartAlignedToWorkingWindowStep(
  args: StepAlignmentArgs,
): { ok: true; timeZone: string; windowStartMinutes: number }
 | { ok: false; code: SlotReadinessCode; timeZone: string; meta?: Record<string, unknown> } {
  const fallbackTimeZone =
    typeof args.fallbackTimeZone === 'string' && args.fallbackTimeZone.trim()
      ? args.fallbackTimeZone
      : DEFAULT_FALLBACK_TIME_ZONE

  const timeZone = sanitizeTimeZone(args.timeZone, fallbackTimeZone)
  const stepMinutes = normalizeStepMinutes(args.stepMinutes, 15)

  const startUtc = normalizeToMinute(new Date(args.startUtc))
  if (!isValidDate(startUtc)) {
    return {
      ok: false,
      code: 'INVALID_START',
      timeZone,
      meta: {
        reason: 'invalid-start',
      },
    }
  }

  const window = getWorkingWindowForDay(startUtc, args.workingHours, timeZone)

  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return {
        ok: false,
        code: 'WORKING_HOURS_REQUIRED',
        timeZone,
        meta: {
          reason: 'missing-working-hours',
        },
      }
    }

    if (window.reason === 'DISABLED') {
      return {
        ok: false,
        code: 'OUTSIDE_WORKING_HOURS',
        timeZone,
        meta: {
          reason: 'disabled-day',
        },
      }
    }

    return {
      ok: false,
      code: 'WORKING_HOURS_INVALID',
      timeZone,
      meta: {
        reason: 'misconfigured-working-hours',
      },
    }
  }

  const startOffset = offsetFromWindowStartDay({
    targetUtc: startUtc,
    windowDayUtc: startUtc,
    timeZone,
  })

  if (startOffset < window.startMinutes) {
    return {
      ok: false,
      code: 'STEP_MISMATCH',
      timeZone,
      meta: {
        reason: 'before-window-start',
        startOffset,
        windowStartMinutes: window.startMinutes,
        windowEndMinutes: window.endMinutes,
        stepMinutes,
      },
    }
  }

  const diff = startOffset - window.startMinutes
  const mod = diff % stepMinutes
  const normalizedMod = mod >= 0 ? mod : mod + stepMinutes

  if (normalizedMod !== 0) {
    return {
      ok: false,
      code: 'STEP_MISMATCH',
      timeZone,
      meta: {
        reason: 'not-on-working-window-step',
        startOffset,
        windowStartMinutes: window.startMinutes,
        windowEndMinutes: window.endMinutes,
        stepMinutes,
        stepRemainder: normalizedMod,
      },
    }
  }

  return {
    ok: true,
    timeZone,
    windowStartMinutes: window.startMinutes,
  }
}

export function checkAdvanceNotice(
  args: AdvanceNoticeArgs,
): { ok: true } | { ok: false; code: 'ADVANCE_NOTICE_REQUIRED'; meta: Record<string, unknown> } {
  const startUtc = normalizeToMinute(new Date(args.startUtc))
  const nowUtc = new Date(args.nowUtc)
  const advanceNoticeMinutes = normalizeAdvanceNoticeMinutes(
    args.advanceNoticeMinutes,
  )

  if (!isValidDate(startUtc)) {
    return {
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
      meta: {
        reason: 'invalid-start',
      },
    }
  }

  if (!isValidDate(nowUtc)) {
    return {
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
      meta: {
        reason: 'invalid-now',
      },
    }
  }

  const cutoffUtc = addMinutes(nowUtc, advanceNoticeMinutes)

  if (startUtc.getTime() < cutoffUtc.getTime()) {
    return {
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
      meta: {
        startUtc: startUtc.toISOString(),
        nowUtc: nowUtc.toISOString(),
        cutoffUtc: cutoffUtc.toISOString(),
        advanceNoticeMinutes,
      },
    }
  }

  return { ok: true }
}

/**
 * Exact timestamp horizon, not local day serial.
 *
 * This intentionally matches write-path behavior and fixes the parity bug
 * where availability exposed slots later on the last allowed day that
 * hold/finalize would reject.
 */
export function checkMaxDaysAheadExact(
  args: MaxDaysAheadArgs,
): { ok: true } | { ok: false; code: 'MAX_DAYS_AHEAD_EXCEEDED'; meta: Record<string, unknown> } {
  const startUtc = normalizeToMinute(new Date(args.startUtc))
  const nowUtc = new Date(args.nowUtc)
  const maxDaysAhead = normalizeMaxDaysAhead(args.maxDaysAhead)

  if (!isValidDate(startUtc)) {
    return {
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      meta: {
        reason: 'invalid-start',
      },
    }
  }

  if (!isValidDate(nowUtc)) {
    return {
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      meta: {
        reason: 'invalid-now',
      },
    }
  }

  const latestAllowedUtc = new Date(
    nowUtc.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000,
  )

  if (startUtc.getTime() > latestAllowedUtc.getTime()) {
    return {
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      meta: {
        startUtc: startUtc.toISOString(),
        nowUtc: nowUtc.toISOString(),
        latestAllowedUtc: latestAllowedUtc.toISOString(),
        maxDaysAhead,
      },
    }
  }

  return { ok: true }
}

export function checkSlotReadiness(
  args: CheckSlotReadinessArgs,
): SlotReadinessResult {
  const fallbackTimeZone =
    typeof args.fallbackTimeZone === 'string' && args.fallbackTimeZone.trim()
      ? args.fallbackTimeZone
      : DEFAULT_FALLBACK_TIME_ZONE

  const timeZone = sanitizeTimeZone(args.timeZone, fallbackTimeZone)
  const stepMinutes = normalizeStepMinutes(args.stepMinutes, 15)
  const durationMinutes = normalizeDurationMinutes(args.durationMinutes)
  const bufferMinutes = normalizeBufferMinutes(args.bufferMinutes)
  const nowUtc = args.nowUtc ? new Date(args.nowUtc) : new Date()

  const startUtc = normalizeToMinute(new Date(args.startUtc))

  if (!isValidDate(startUtc)) {
    return {
      ok: false,
      code: 'INVALID_START',
      timeZone,
      stepMinutes,
      durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : 0,
      bufferMinutes: Number.isFinite(bufferMinutes) ? bufferMinutes : 0,
    }
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes < 15) {
    return {
      ok: false,
      code: 'INVALID_DURATION',
      timeZone,
      stepMinutes,
      durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : 0,
      bufferMinutes: Number.isFinite(bufferMinutes) ? bufferMinutes : 0,
    }
  }

  if (!Number.isFinite(bufferMinutes) || bufferMinutes < 0) {
    return {
      ok: false,
      code: 'INVALID_BUFFER',
      timeZone,
      stepMinutes,
      durationMinutes,
      bufferMinutes: Number.isFinite(bufferMinutes) ? bufferMinutes : 0,
    }
  }

  const endUtc = computeRequestedEndUtc({
    startUtc,
    durationMinutes,
    bufferMinutes,
  })

  if (!isValidDate(endUtc) || endUtc.getTime() <= startUtc.getTime()) {
    return {
      ok: false,
      code: 'INVALID_RANGE',
      startUtc,
      endUtc,
      timeZone,
      stepMinutes,
      durationMinutes,
      bufferMinutes,
    }
  }

  const stepCheck = isStartAlignedToWorkingWindowStep({
    startUtc,
    workingHours: args.workingHours,
    timeZone,
    stepMinutes,
    fallbackTimeZone,
  })

  if (!stepCheck.ok) {
    return {
      ok: false,
      code: stepCheck.code,
      startUtc,
      endUtc,
      timeZone: stepCheck.timeZone,
      stepMinutes,
      durationMinutes,
      bufferMinutes,
      meta: stepCheck.meta,
    }
  }

  const advanceNoticeCheck = checkAdvanceNotice({
    startUtc,
    nowUtc,
    advanceNoticeMinutes: args.advanceNoticeMinutes,
  })

  if (!advanceNoticeCheck.ok) {
    return {
      ok: false,
      code: advanceNoticeCheck.code,
      startUtc,
      endUtc,
      timeZone,
      stepMinutes,
      durationMinutes,
      bufferMinutes,
      meta: advanceNoticeCheck.meta,
    }
  }

  const maxDaysAheadCheck = checkMaxDaysAheadExact({
    startUtc,
    nowUtc,
    maxDaysAhead: args.maxDaysAhead,
  })

  if (!maxDaysAheadCheck.ok) {
    return {
      ok: false,
      code: maxDaysAheadCheck.code,
      startUtc,
      endUtc,
      timeZone,
      stepMinutes,
      durationMinutes,
      bufferMinutes,
      meta: maxDaysAheadCheck.meta,
    }
  }

  const workingHoursCheck = ensureWithinWorkingHours({
    scheduledStartUtc: startUtc,
    scheduledEndUtc: endUtc,
    workingHours: args.workingHours,
    timeZone,
    fallbackTimeZone,
    messages: {
      missing: makeWorkingHoursGuardMessage('WORKING_HOURS_REQUIRED'),
      outside: makeWorkingHoursGuardMessage('OUTSIDE_WORKING_HOURS'),
      misconfigured: makeWorkingHoursGuardMessage('WORKING_HOURS_INVALID'),
    },
  })

  if (!workingHoursCheck.ok) {
    const parsed = parseWorkingHoursGuardMessage(workingHoursCheck.error)

    if (parsed === 'WORKING_HOURS_REQUIRED') {
      return {
        ok: false,
        code: 'WORKING_HOURS_REQUIRED',
        startUtc,
        endUtc,
        timeZone,
        stepMinutes,
        durationMinutes,
        bufferMinutes,
      }
    }

    if (parsed === 'WORKING_HOURS_INVALID') {
      return {
        ok: false,
        code: 'WORKING_HOURS_INVALID',
        startUtc,
        endUtc,
        timeZone,
        stepMinutes,
        durationMinutes,
        bufferMinutes,
      }
    }

    return {
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
      startUtc,
      endUtc,
      timeZone,
      stepMinutes,
      durationMinutes,
      bufferMinutes,
      meta: {
        workingHoursError: workingHoursCheck.error,
      },
    }
  }

  return {
    ok: true,
    startUtc,
    endUtc,
    timeZone,
    stepMinutes,
    durationMinutes,
    bufferMinutes,
  }
}