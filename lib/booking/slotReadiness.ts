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
import {
  getWorkingWindowForDay,
  offsetFromWindowStartDay,
} from '@/lib/scheduling/workingHours'
import {
  ensureWithinWorkingHours,
  getReadableWorkingHoursMessage,
  makeWorkingHoursGuardMessage,
  parseWorkingHoursGuardMessage,
} from '@/lib/booking/workingHoursGuard'
import { normalizeStepMinutes } from '@/lib/booking/locationContext'
import { type BookingErrorCode } from '@/lib/booking/errors'

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

type PreparedStepAlignmentArgs = {
  startUtc: Date
  workingHours: unknown
  timeZone: string
  stepMinutes: number
}

type ResolvedWorkingWindow =
  | {
      ok: true
      startUtc: Date
      timeZone: string
      stepMinutes: number
      windowStartMinutes: number
      windowEndMinutes: number
      startOffset: number
    }
  | {
      ok: false
      code: SlotReadinessCode
      timeZone: string
      stepMinutes: number
      meta?: Record<string, unknown>
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

function resolveWorkingWindowForPreparedArgs(
  args: PreparedStepAlignmentArgs,
): ResolvedWorkingWindow {
  const window = getWorkingWindowForDay(args.startUtc, args.workingHours, args.timeZone)

  if (!window.ok) {
    if (window.reason === 'MISSING') {
      return {
        ok: false,
        code: 'WORKING_HOURS_REQUIRED',
        timeZone: args.timeZone,
        stepMinutes: args.stepMinutes,
        meta: {
          reason: 'missing-working-hours',
        },
      }
    }

    if (window.reason === 'DISABLED') {
      return {
        ok: false,
        code: 'OUTSIDE_WORKING_HOURS',
        timeZone: args.timeZone,
        stepMinutes: args.stepMinutes,
        meta: {
          reason: 'disabled-day',
        },
      }
    }

    return {
      ok: false,
      code: 'WORKING_HOURS_INVALID',
      timeZone: args.timeZone,
      stepMinutes: args.stepMinutes,
      meta: {
        reason: 'misconfigured-working-hours',
      },
    }
  }

  const startOffset = offsetFromWindowStartDay({
    targetUtc: args.startUtc,
    windowDayUtc: args.startUtc,
    timeZone: args.timeZone,
  })

  return {
    ok: true,
    startUtc: args.startUtc,
    timeZone: args.timeZone,
    stepMinutes: args.stepMinutes,
    windowStartMinutes: window.startMinutes,
    windowEndMinutes: window.endMinutes,
    startOffset,
  }
}

function validateWorkingWindowStep(
  resolved: ResolvedWorkingWindow,
):
  | { ok: true; timeZone: string; windowStartMinutes: number }
  | {
      ok: false
      code: SlotReadinessCode
      timeZone: string
      meta?: Record<string, unknown>
    } {
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      timeZone: resolved.timeZone,
      meta: resolved.meta,
    }
  }

  if (resolved.startOffset < resolved.windowStartMinutes) {
    return {
      ok: false,
      code: 'STEP_MISMATCH',
      timeZone: resolved.timeZone,
      meta: {
        reason: 'before-window-start',
        startOffset: resolved.startOffset,
        windowStartMinutes: resolved.windowStartMinutes,
        windowEndMinutes: resolved.windowEndMinutes,
        stepMinutes: resolved.stepMinutes,
      },
    }
  }

  const diff = resolved.startOffset - resolved.windowStartMinutes
  const mod = diff % resolved.stepMinutes
  const normalizedMod = mod >= 0 ? mod : mod + resolved.stepMinutes

  if (normalizedMod !== 0) {
    return {
      ok: false,
      code: 'STEP_MISMATCH',
      timeZone: resolved.timeZone,
      meta: {
        reason: 'not-on-working-window-step',
        startOffset: resolved.startOffset,
        windowStartMinutes: resolved.windowStartMinutes,
        windowEndMinutes: resolved.windowEndMinutes,
        stepMinutes: resolved.stepMinutes,
        stepRemainder: normalizedMod,
      },
    }
  }

  return {
    ok: true,
    timeZone: resolved.timeZone,
    windowStartMinutes: resolved.windowStartMinutes,
  }
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
):
  | { ok: true; timeZone: string; windowStartMinutes: number }
  | {
      ok: false
      code: SlotReadinessCode
      timeZone: string
      meta?: Record<string, unknown>
    } {
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

  const resolved = resolveWorkingWindowForPreparedArgs({
    startUtc,
    workingHours: args.workingHours,
    timeZone,
    stepMinutes,
  })

  return validateWorkingWindowStep(resolved)
}

// Snap a start time to the nearest valid slot on the pro's working-window step
// grid, for calendar-migration imports (a competitor export's arbitrary times
// rarely land on the grid). Only corrects MINOR misalignment within working
// hours — adjusts by less than half a step. Returns null (caller should hold the
// time as a block instead) when there's no usable window that day or the start
// is before the window opens, so appointments are never relocated by a large
// amount or fabricated onto a closed day.
export function snapStartToWorkingWindowStep(args: StepAlignmentArgs): Date | null {
  const fallbackTimeZone =
    typeof args.fallbackTimeZone === 'string' && args.fallbackTimeZone.trim()
      ? args.fallbackTimeZone
      : DEFAULT_FALLBACK_TIME_ZONE

  const timeZone = sanitizeTimeZone(args.timeZone, fallbackTimeZone)
  const stepMinutes = normalizeStepMinutes(args.stepMinutes, 15)
  const startUtc = normalizeToMinute(new Date(args.startUtc))

  if (!isValidDate(startUtc)) return null

  const resolved = resolveWorkingWindowForPreparedArgs({
    startUtc,
    workingHours: args.workingHours,
    timeZone,
    stepMinutes,
  })

  if (!resolved.ok) return null
  // Don't relocate appointments that start before the window opens — hold them.
  if (resolved.startOffset < resolved.windowStartMinutes) return null

  const diff = resolved.startOffset - resolved.windowStartMinutes
  const snappedOffset =
    resolved.windowStartMinutes + Math.round(diff / stepMinutes) * stepMinutes
  const deltaMinutes = snappedOffset - resolved.startOffset

  return deltaMinutes === 0 ? startUtc : addMinutes(startUtc, deltaMinutes)
}

export function checkAdvanceNotice(
  args: AdvanceNoticeArgs,
):
  | { ok: true }
  | { ok: false; code: 'ADVANCE_NOTICE_REQUIRED'; meta: Record<string, unknown> } {
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
):
  | { ok: true }
  | { ok: false; code: 'MAX_DAYS_AHEAD_EXCEEDED'; meta: Record<string, unknown> } {
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

  const workingWindow = resolveWorkingWindowForPreparedArgs({
    startUtc,
    workingHours: args.workingHours,
    timeZone,
    stepMinutes,
  })

  const stepCheck = validateWorkingWindowStep(workingWindow)

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

/**
 * The single translation from a slot-readiness refusal to the booking error the
 * caller reports.
 *
 * Both writers that gate on `checkSlotReadiness` go through here — the hold
 * (`evaluateHoldCreationDecision`, which refuses at CLAIM time) and last-minute
 * opening creation (which refuses at CREATE time). They must agree: an opening a
 * pro is allowed to create has to be one a client is allowed to hold, or the
 * opening lands in the feed and every claim fails. Keeping the mapping in one
 * place is what makes "same policy" true rather than merely intended.
 */
export function mapSlotReadinessToBookingError(args: {
  code: SlotReadinessCode
  stepMinutes: number
  /** `meta.workingHoursError` off the failed result, when the code carries one. */
  workingHoursError?: unknown
}): {
  code: BookingErrorCode
  message?: string
  userMessage?: string
} {
  switch (args.code) {
    case 'STEP_MISMATCH': {
      const message = `Start time must be on a ${args.stepMinutes}-minute boundary.`
      return { code: 'STEP_MISMATCH', message, userMessage: message }
    }

    case 'OUTSIDE_WORKING_HOURS': {
      const message = getReadableWorkingHoursMessage(args.workingHoursError)
      return { code: 'OUTSIDE_WORKING_HOURS', message, userMessage: message }
    }

    case 'ADVANCE_NOTICE_REQUIRED':
      return { code: 'ADVANCE_NOTICE_REQUIRED' }

    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return { code: 'MAX_DAYS_AHEAD_EXCEEDED' }

    case 'WORKING_HOURS_REQUIRED':
      return { code: 'WORKING_HOURS_REQUIRED' }

    case 'WORKING_HOURS_INVALID':
      return { code: 'WORKING_HOURS_INVALID' }

    case 'INVALID_START':
      return { code: 'INVALID_SCHEDULED_FOR' }

    case 'INVALID_RANGE':
      return { code: 'INVALID_SCHEDULED_FOR' }

    case 'INVALID_DURATION':
      return { code: 'DURATION_REQUIRED' }

    case 'INVALID_BUFFER':
      return {
        code: 'INTERNAL_ERROR',
        message: 'Invalid buffer minutes.',
        userMessage: 'That time is not available.',
      }
  }
}
