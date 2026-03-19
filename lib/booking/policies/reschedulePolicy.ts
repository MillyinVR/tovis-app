// lib/booking/policies/reschedulePolicy.ts
import { Prisma } from '@prisma/client'
import { addMinutes } from '@/lib/booking/conflicts'
import { assertTimeRangeAvailable } from '@/lib/booking/conflictQueries'
import {
  checkSlotReadiness,
  type SlotReadinessCode,
} from '@/lib/booking/slotReadiness'
import { type BookingErrorCode } from '@/lib/booking/errors'

const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

export type RescheduleDecision =
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
    }

export type EvaluateRescheduleDecisionArgs = {
  tx: Prisma.TransactionClient
  now: Date
  professionalId: string
  bookingId: string
  holdId: string
  requestedStart: Date
  durationMinutes: number
  bufferMinutes: number
  locationId: string
  workingHours: unknown
  timeZone: string
  stepMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  fallbackTimeZone?: string
}

function decisionOk(requestedEnd: Date): RescheduleDecision {
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
  },
): RescheduleDecision {
  return {
    ok: false,
    code,
    message: overrides?.message,
    userMessage: overrides?.userMessage,
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
      return 'HOLD_TIME_INVALID'
    case 'INVALID_DURATION':
      return 'INVALID_DURATION'
    case 'INVALID_BUFFER':
      return 'INTERNAL_ERROR'
    case 'INVALID_RANGE':
      return 'HOLD_TIME_INVALID'
  }
}

function mapSlotReadinessFailure(args: {
  code: SlotReadinessCode
  stepMinutes: number
  meta?: Record<string, unknown>
}): RescheduleDecision {
  if (args.code === 'STEP_MISMATCH') {
    return decisionFail('STEP_MISMATCH', {
      message: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
      userMessage: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
    })
  }

  if (args.code === 'OUTSIDE_WORKING_HOURS') {
    const message = getReadableWorkingHoursMessage(
      args.meta?.workingHoursError,
    )

    return decisionFail('OUTSIDE_WORKING_HOURS', {
      message,
      userMessage: message,
    })
  }

  if (args.code === 'INVALID_BUFFER') {
    return decisionFail('INTERNAL_ERROR', {
      message: 'Invalid buffer minutes.',
      userMessage: 'Failed to reschedule booking.',
    })
  }

  return decisionFail(mapSlotReadinessCodeToBookingCode(args.code))
}

export async function evaluateRescheduleDecision(
  args: EvaluateRescheduleDecisionArgs,
): Promise<RescheduleDecision> {
  if (!Number.isFinite(args.requestedStart.getTime())) {
    return decisionFail('HOLD_TIME_INVALID')
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
    return mapSlotReadinessFailure({
      code: slotReadiness.code,
      stepMinutes: args.stepMinutes,
      meta: (slotReadiness.meta as Record<string, unknown> | undefined) ?? undefined,
    })
  }

  const requestedEnd = slotReadiness.endUtc ?? computedRequestedEnd

  try {
    await assertTimeRangeAvailable({
      tx: args.tx,
      professionalId: args.professionalId,
      locationId: args.locationId,
      requestedStart: args.requestedStart,
      requestedEnd,
      defaultBufferMinutes: args.bufferMinutes,
      fallbackDurationMinutes: args.durationMinutes,
      excludeBookingId: args.bookingId,
      excludeHoldId: args.holdId,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'TIME_BLOCKED') {
      return decisionFail('TIME_BLOCKED')
    }

    if (message === 'TIME_BOOKED') {
      return decisionFail('TIME_BOOKED')
    }

    if (message === 'TIME_HELD') {
      return decisionFail('TIME_HELD')
    }

    throw error
  }

  return decisionOk(requestedEnd)
}