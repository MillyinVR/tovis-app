// lib/booking/policies/proSchedulingPolicy.ts

import { Prisma, ServiceLocationType } from '@prisma/client'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'
import {
  checkAdvanceNotice,
  checkMaxDaysAheadExact,
  computeRequestedEndUtc,
  isStartAlignedToWorkingWindowStep,
} from '@/lib/booking/slotReadiness'
import {
  policyFail,
  policyOk,
  type PolicyResult,
  type SchedulingPolicyFailureCode,
} from './types'

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

export type ProSchedulingAppliedOverride =
  | 'ADVANCE_NOTICE'
  | 'MAX_DAYS_AHEAD'
  | 'WORKING_HOURS'

export type EvaluateProSchedulingDecisionArgs = {
  tx?: Prisma.TransactionClient
  now: Date
  professionalId: string
  locationId: string | null
  locationType: ServiceLocationType
  requestedStart: Date
  durationMinutes: number
  bufferMinutes: number
  workingHours: unknown
  timeZone: string
  stepMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  allowShortNotice: boolean
  allowFarFuture: boolean
  allowOutsideWorkingHours: boolean
  excludeBookingId?: string | null
  excludeHoldId?: string | null
  // Booking/hold overlaps are owned by decideBookingOverlapPermission, which
  // can authorize a PRO/ADMIN double-book (or an aftercare pre-selected slot).
  // Callers that run the overlap policy right after this gate set this so the
  // actor-blind busy check here doesn't shadow that decision. Calendar blocks
  // stay fatal either way — the overlap policy has no concept of blocks.
  deferBusyConflictsToOverlapPolicy?: boolean
}

export type ProSchedulingDecision = {
  requestedEnd: Date
  appliedOverrides: ProSchedulingAppliedOverride[]
}

export type ProSchedulingDecisionResult = PolicyResult<
  ProSchedulingDecision,
  SchedulingPolicyFailureCode
>

export async function evaluateProSchedulingDecision(
  args: EvaluateProSchedulingDecisionArgs,
): Promise<ProSchedulingDecisionResult> {
  const requestedEnd = computeRequestedEndUtc({
    startUtc: args.requestedStart,
    durationMinutes: args.durationMinutes,
    bufferMinutes: args.bufferMinutes,
  })

  const appliedOverrides: ProSchedulingAppliedOverride[] = []

  const stepCheck = isStartAlignedToWorkingWindowStep({
    startUtc: args.requestedStart,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
    stepMinutes: args.stepMinutes,
    fallbackTimeZone: 'UTC',
  })

  if (!stepCheck.ok) {
    // A pro setting an appointment on their own calendar may pick ANY start
    // minute. The step grid (e.g. 30-min slots, anchored to the working-window
    // start) is a client self-booking nicety, not a constraint on the pro — so
    // STEP_MISMATCH is intentionally NOT fatal here. Only the working-hours
    // codes from the alignment helper are surfaced; working hours, advance
    // notice, max-days-ahead, and conflicts are all still enforced below.
    if (stepCheck.code === 'WORKING_HOURS_REQUIRED') {
      return policyFail('WORKING_HOURS_REQUIRED', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: makeWorkingHoursGuardMessage(
            'WORKING_HOURS_REQUIRED',
          ),
        },
      })
    }

    if (stepCheck.code === 'WORKING_HOURS_INVALID') {
      return policyFail('WORKING_HOURS_INVALID', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: makeWorkingHoursGuardMessage(
            'WORKING_HOURS_INVALID',
          ),
        },
      })
    }

    // OUTSIDE_WORKING_HOURS is intentionally not fatal here.
    // We let the full range guard decide.
  }

  const advanceNoticeCheck = checkAdvanceNotice({
    startUtc: args.requestedStart,
    nowUtc: args.now,
    advanceNoticeMinutes: args.advanceNoticeMinutes,
  })

  if (!advanceNoticeCheck.ok) {
    if (!args.allowShortNotice) {
      return policyFail('ADVANCE_NOTICE_REQUIRED', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'TIME_NOT_AVAILABLE',
        meta: {
          rule: 'ADVANCE_NOTICE',
          advanceNoticeMinutes: args.advanceNoticeMinutes,
          ...(advanceNoticeCheck.meta ?? {}),
        },
      })
    }

    appliedOverrides.push('ADVANCE_NOTICE')
  }

  const maxDaysAheadCheck = checkMaxDaysAheadExact({
    startUtc: args.requestedStart,
    nowUtc: args.now,
    maxDaysAhead: args.maxDaysAhead,
  })

  if (!maxDaysAheadCheck.ok) {
    if (!args.allowFarFuture) {
      return policyFail('MAX_DAYS_AHEAD_EXCEEDED', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'TIME_NOT_AVAILABLE',
        meta: {
          rule: 'MAX_DAYS_AHEAD',
          maxDaysAhead: args.maxDaysAhead,
          ...(maxDaysAheadCheck.meta ?? {}),
        },
      })
    }

    appliedOverrides.push('MAX_DAYS_AHEAD')
  }

  const workingHoursCheck = ensureWithinWorkingHours({
    scheduledStartUtc: args.requestedStart,
    scheduledEndUtc: requestedEnd,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
    fallbackTimeZone: 'UTC',
    messages: {
      missing: makeWorkingHoursGuardMessage('WORKING_HOURS_REQUIRED'),
      outside: makeWorkingHoursGuardMessage('OUTSIDE_WORKING_HOURS'),
      misconfigured: makeWorkingHoursGuardMessage('WORKING_HOURS_INVALID'),
    },
  })

  if (!workingHoursCheck.ok) {
    const parsed = parseWorkingHoursGuardMessage(workingHoursCheck.error)

    if (parsed === 'WORKING_HOURS_REQUIRED') {
      return policyFail('WORKING_HOURS_REQUIRED', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: workingHoursCheck.error,
        },
      })
    }

    if (parsed === 'WORKING_HOURS_INVALID') {
      return policyFail('WORKING_HOURS_INVALID', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: workingHoursCheck.error,
        },
      })
    }

    if (!args.allowOutsideWorkingHours) {
      return policyFail('OUTSIDE_WORKING_HOURS', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: workingHoursCheck.error,
        },
      })
    }

    appliedOverrides.push('WORKING_HOURS')
  }

  const conflict = await getTimeRangeConflict({
    tx: args.tx,
    professionalId: args.professionalId,
    locationId: args.locationId,
    requestedStart: args.requestedStart,
    requestedEnd,
    defaultBufferMinutes: args.bufferMinutes,
    fallbackDurationMinutes: args.durationMinutes,
    excludeBookingId: args.excludeBookingId ?? null,
    excludeHoldId: args.excludeHoldId ?? null,
    nowUtc: args.now,
  })

  if (conflict === 'BLOCKED') {
    return policyFail('TIME_BLOCKED', {
      requestedStart: args.requestedStart,
      requestedEnd,
      conflictType: 'BLOCKED',
    })
  }

  if (!args.deferBusyConflictsToOverlapPolicy) {
    if (conflict === 'BOOKING') {
      return policyFail('TIME_BOOKED', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'BOOKING',
      })
    }

    if (conflict === 'HOLD') {
      return policyFail('TIME_HELD', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'HOLD',
      })
    }
  }

  return policyOk({
    requestedEnd,
    appliedOverrides,
  })
}