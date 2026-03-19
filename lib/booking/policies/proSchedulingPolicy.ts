// lib/booking/policies/proSchedulingPolicy.ts

import { Prisma, ServiceLocationType } from '@prisma/client'
import { addMinutes } from '@/lib/booking/conflicts'
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
}

export type ProSchedulingDecision = {
  requestedEnd: Date
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

  const stepCheck = isStartAlignedToWorkingWindowStep({
    startUtc: args.requestedStart,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
    stepMinutes: args.stepMinutes,
    fallbackTimeZone: 'UTC',
  })

  if (!stepCheck.ok) {
    if (stepCheck.code === 'STEP_MISMATCH') {
      return policyFail('STEP_MISMATCH', {
        requestedStart: args.requestedStart,
        requestedEnd: addMinutes(args.requestedStart, 1),
        conflictType: 'STEP_BOUNDARY',
        meta: {
          stepMinutes: args.stepMinutes,
          ...(stepCheck.meta ?? {}),
        },
      })
    }

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
    // We let the full range guard decide, so the behavior stays aligned
    // with the current pro create/edit routes.
  }

  if (!args.allowShortNotice) {
    const advanceNoticeCheck = checkAdvanceNotice({
      startUtc: args.requestedStart,
      nowUtc: args.now,
      advanceNoticeMinutes: args.advanceNoticeMinutes,
    })

    if (!advanceNoticeCheck.ok) {
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
  }

  if (!args.allowFarFuture) {
    const maxDaysAheadCheck = checkMaxDaysAheadExact({
      startUtc: args.requestedStart,
      nowUtc: args.now,
      maxDaysAhead: args.maxDaysAhead,
    })

    if (!maxDaysAheadCheck.ok) {
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
  }

  if (!args.allowOutsideWorkingHours) {
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

      return policyFail('OUTSIDE_WORKING_HOURS', {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: workingHoursCheck.error,
        },
      })
    }
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

  return policyOk({
    requestedEnd,
  })
}