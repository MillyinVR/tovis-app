// lib/booking/policies/finalizePolicy.ts
import { Prisma, ServiceLocationType } from '@prisma/client'
import { addMinutes } from '@/lib/booking/conflicts'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import {
  checkSlotReadiness,
  type SlotReadinessCode,
} from '@/lib/booking/slotReadiness'
import { type BookingErrorCode } from '@/lib/booking/errors'

const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

export type FinalizePolicyConflictType =
  | 'BLOCKED'
  | 'BOOKING'
  | 'HOLD'
  | 'WORKING_HOURS'
  | 'STEP_BOUNDARY'
  | 'TIME_NOT_AVAILABLE'

export type FinalizePolicyLogHint = {
  requestedStart: Date
  requestedEnd: Date
  conflictType: FinalizePolicyConflictType
  meta?: Record<string, unknown>
}

export type FinalizeDecision =
  | {
      ok: true
      value: {
        requestedEnd: Date
      }
    }
  | {
      ok: false
      code: BookingErrorCode
      message?: string
      userMessage?: string
      logHint?: FinalizePolicyLogHint
    }

export type EvaluateFinalizeDecisionArgs = {
  tx: Prisma.TransactionClient
  now: Date
  professionalId: string
  holdId: string
  requestedStart: Date
  durationMinutes: number
  bufferMinutes: number
  locationId: string
  locationType: ServiceLocationType
  workingHours: unknown
  timeZone: string
  stepMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  fallbackTimeZone?: string
}

function decisionOk(requestedEnd: Date): FinalizeDecision {
  return {
    ok: true,
    value: {
      requestedEnd,
    },
  }
}

function decisionFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
    logHint?: FinalizePolicyLogHint
  },
): FinalizeDecision {
  return {
    ok: false,
    code,
    message: overrides?.message,
    userMessage: overrides?.userMessage,
    logHint: overrides?.logHint,
  }
}

function getReadableWorkingHoursMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return 'That time is outside working hours.'
  }

  if (value.startsWith(WORKING_HOURS_ERROR_PREFIX)) {
    return 'That time is outside working hours.'
  }

  return value
}

function getSlotReadinessConflictType(
  code: SlotReadinessCode,
): FinalizePolicyConflictType {
  if (code === 'STEP_MISMATCH') return 'STEP_BOUNDARY'

  if (
    code === 'WORKING_HOURS_REQUIRED' ||
    code === 'WORKING_HOURS_INVALID' ||
    code === 'OUTSIDE_WORKING_HOURS'
  ) {
    return 'WORKING_HOURS'
  }

  return 'TIME_NOT_AVAILABLE'
}

function getSlotReadinessLoggedEnd(args: {
  code: SlotReadinessCode
  requestedStart: Date
  requestedEnd: Date
}): Date {
  switch (args.code) {
    case 'STEP_MISMATCH':
    case 'INVALID_START':
    case 'INVALID_RANGE':
      return addMinutes(args.requestedStart, 1)
    default:
      return args.requestedEnd
  }
}

function mapSlotReadinessCodeToBookingCode(
  code: SlotReadinessCode,
): BookingErrorCode {
  switch (code) {
    case 'STEP_MISMATCH':
      return 'STEP_MISMATCH'
    case 'ADVANCE_NOTICE_REQUIRED':
      return 'ADVANCE_NOTICE_REQUIRED'
    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return 'MAX_DAYS_AHEAD_EXCEEDED'
    case 'WORKING_HOURS_REQUIRED':
      return 'WORKING_HOURS_REQUIRED'
    case 'WORKING_HOURS_INVALID':
      return 'WORKING_HOURS_INVALID'
    case 'OUTSIDE_WORKING_HOURS':
      return 'OUTSIDE_WORKING_HOURS'
    case 'INVALID_START':
      return 'INVALID_SCHEDULED_FOR'
    case 'INVALID_DURATION':
      return 'INVALID_DURATION'
    case 'INVALID_BUFFER':
      return 'INTERNAL_ERROR'
    case 'INVALID_RANGE':
      return 'INVALID_SCHEDULED_FOR'
  }
}

function buildSlotReadinessFailure(args: {
  code: SlotReadinessCode
  stepMinutes: number
  requestedStart: Date
  requestedEnd: Date
  meta?: Record<string, unknown>
}): FinalizeDecision {
  const logHint: FinalizePolicyLogHint = {
    requestedStart: args.requestedStart,
    requestedEnd: getSlotReadinessLoggedEnd({
      code: args.code,
      requestedStart: args.requestedStart,
      requestedEnd: args.requestedEnd,
    }),
    conflictType: getSlotReadinessConflictType(args.code),
    meta: {
      slotReadinessCode: args.code,
      ...(args.meta ?? {}),
    },
  }

  if (args.code === 'STEP_MISMATCH') {
    return decisionFail('STEP_MISMATCH', {
      message: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
      userMessage: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
      logHint,
    })
  }

  if (args.code === 'OUTSIDE_WORKING_HOURS') {
    const message = getReadableWorkingHoursMessage(args.meta?.workingHoursError)

    return decisionFail('OUTSIDE_WORKING_HOURS', {
      message,
      userMessage: message,
      logHint,
    })
  }

  if (args.code === 'INVALID_BUFFER') {
    return decisionFail('INTERNAL_ERROR', {
      message: 'Invalid buffer minutes.',
      userMessage: 'Failed to finalize booking.',
      logHint,
    })
  }

  return decisionFail(mapSlotReadinessCodeToBookingCode(args.code), {
    logHint,
  })
}

export async function evaluateFinalizeDecision(
  args: EvaluateFinalizeDecisionArgs,
): Promise<FinalizeDecision> {
  if (!Number.isFinite(args.requestedStart.getTime())) {
    return decisionFail('INVALID_SCHEDULED_FOR')
  }

  if (args.requestedStart.getTime() < args.now.getTime()) {
    return decisionFail('TIME_IN_PAST')
  }

  const computedRequestedEnd = addMinutes(
    args.requestedStart,
    args.durationMinutes + args.bufferMinutes,
  )

  const slotReadiness = checkSlotReadiness({
    startUtc: args.requestedStart,
    nowUtc: args.now,
    durationMinutes: args.durationMinutes,
    bufferMinutes: args.bufferMinutes,
    workingHours: args.workingHours,
    timeZone: args.timeZone,
    stepMinutes: args.stepMinutes,
    advanceNoticeMinutes: args.advanceNoticeMinutes,
    maxDaysAhead: args.maxDaysAhead,
    fallbackTimeZone: args.fallbackTimeZone ?? 'UTC',
  })

  if (!slotReadiness.ok) {
    return buildSlotReadinessFailure({
      code: slotReadiness.code,
      stepMinutes: args.stepMinutes,
      requestedStart: args.requestedStart,
      requestedEnd: computedRequestedEnd,
      meta:
        (slotReadiness.meta as Record<string, unknown> | undefined) ?? undefined,
    })
  }

  const requestedEnd = slotReadiness.endUtc

  const conflict = await getTimeRangeConflict({
    tx: args.tx,
    professionalId: args.professionalId,
    locationId: args.locationId,
    requestedStart: args.requestedStart,
    requestedEnd,
    defaultBufferMinutes: args.bufferMinutes,
    fallbackDurationMinutes: args.durationMinutes,
    excludeHoldId: args.holdId,
    nowUtc: args.now,
  })

  if (conflict === 'BLOCKED') {
    return decisionFail('TIME_BLOCKED', {
      logHint: {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'BLOCKED',
      },
    })
  }

  if (conflict === 'BOOKING') {
    return decisionFail('TIME_BOOKED', {
      logHint: {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'BOOKING',
      },
    })
  }

  if (conflict === 'HOLD') {
    return decisionFail('TIME_HELD', {
      logHint: {
        requestedStart: args.requestedStart,
        requestedEnd,
        conflictType: 'HOLD',
      },
    })
  }

  return decisionOk(requestedEnd)
}