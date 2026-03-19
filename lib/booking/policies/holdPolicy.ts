import { Prisma, ServiceLocationType } from '@prisma/client'
import { addMinutes } from '@/lib/booking/conflicts'
import { getTimeRangeConflict } from '@/lib/booking/conflictQueries'
import {
  checkSlotReadiness,
  type SlotReadinessCode,
} from '@/lib/booking/slotReadiness'
import { type BookingErrorCode } from '@/lib/booking/errors'

const WORKING_HOURS_ERROR_PREFIX = 'BOOKING_WORKING_HOURS:'

export type HoldPolicyConflictType =
  | 'BLOCKED'
  | 'BOOKING'
  | 'HOLD'
  | 'WORKING_HOURS'
  | 'STEP_BOUNDARY'
  | 'TIME_NOT_AVAILABLE'

export type HoldPolicyLogHint = {
  requestedStart: Date
  requestedEnd: Date
  conflictType: HoldPolicyConflictType
  meta?: Record<string, unknown>
}

export type HoldCreationDecision = {
  requestedEnd: Date
}

export type HoldCreationDecisionResult =
  | {
      ok: true
      value: HoldCreationDecision
    }
  | {
      ok: false
      code: BookingErrorCode
      message?: string
      userMessage?: string
      logHint?: HoldPolicyLogHint
    }

export type EvaluateHoldCreationDecisionArgs = {
  tx: Prisma.TransactionClient
  now: Date
  professionalId: string
  locationId: string
  locationType: ServiceLocationType
  offeringId: string
  clientId: string
  clientAddressId: string | null
  requestedStart: Date
  durationMinutes: number
  bufferMinutes: number
  workingHours: unknown
  timeZone: string
  stepMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  salonLocationAddress: string | null
  clientServiceAddress: string | null
}

function decisionFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
    logHint?: HoldPolicyLogHint
  },
): HoldCreationDecisionResult {
  return {
    ok: false,
    code,
    message: overrides?.message,
    userMessage: overrides?.userMessage,
    logHint: overrides?.logHint,
  }
}

function decisionOk(value: HoldCreationDecision): HoldCreationDecisionResult {
  return {
    ok: true,
    value,
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
): HoldPolicyConflictType {
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

function mapSlotReadinessFailure(args: {
  code: SlotReadinessCode
  stepMinutes: number
  workingHoursError?: unknown
  requestedStart: Date
  requestedEnd: Date
  meta?: Record<string, unknown>
}): HoldCreationDecisionResult {
  const logHint: HoldPolicyLogHint = {
    requestedStart: args.requestedStart,
    requestedEnd: args.requestedEnd,
    conflictType: getSlotReadinessConflictType(args.code),
    meta: {
      slotReadinessCode: args.code,
      ...(args.meta ?? {}),
    },
  }

  switch (args.code) {
    case 'STEP_MISMATCH':
      return decisionFail('STEP_MISMATCH', {
        message: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
        userMessage: `Start time must be on a ${args.stepMinutes}-minute boundary.`,
        logHint,
      })

    case 'ADVANCE_NOTICE_REQUIRED':
      return decisionFail('ADVANCE_NOTICE_REQUIRED', {
        logHint,
      })

    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return decisionFail('MAX_DAYS_AHEAD_EXCEEDED', {
        logHint,
      })

    case 'WORKING_HOURS_REQUIRED':
      return decisionFail('WORKING_HOURS_REQUIRED', {
        logHint: {
          ...logHint,
          meta: {
            ...(logHint.meta ?? {}),
            workingHoursError: `${WORKING_HOURS_ERROR_PREFIX}WORKING_HOURS_REQUIRED`,
          },
        },
      })

    case 'WORKING_HOURS_INVALID':
      return decisionFail('WORKING_HOURS_INVALID', {
        logHint: {
          ...logHint,
          meta: {
            ...(logHint.meta ?? {}),
            workingHoursError: `${WORKING_HOURS_ERROR_PREFIX}WORKING_HOURS_INVALID`,
          },
        },
      })

    case 'OUTSIDE_WORKING_HOURS': {
      const message = getReadableWorkingHoursMessage(args.workingHoursError)

      return decisionFail('OUTSIDE_WORKING_HOURS', {
        message,
        userMessage: message,
        logHint: {
          ...logHint,
          meta: {
            ...(logHint.meta ?? {}),
            workingHoursError:
              args.workingHoursError ??
              `${WORKING_HOURS_ERROR_PREFIX}OUTSIDE_WORKING_HOURS`,
          },
        },
      })
    }

    case 'INVALID_START':
      return decisionFail('INVALID_SCHEDULED_FOR', {
        logHint,
      })

    case 'INVALID_DURATION':
      return decisionFail('DURATION_REQUIRED', {
        logHint,
      })

    case 'INVALID_BUFFER':
      return decisionFail('INTERNAL_ERROR', {
        message: 'Invalid buffer minutes.',
        userMessage: 'That time is not available.',
        logHint,
      })

    case 'INVALID_RANGE':
      return decisionFail('INVALID_SCHEDULED_FOR', {
        logHint,
      })
  }
}

export async function evaluateHoldCreationDecision(
  args: EvaluateHoldCreationDecisionArgs,
): Promise<HoldCreationDecisionResult> {
  if (args.locationType === ServiceLocationType.MOBILE) {
    if (!args.clientAddressId) {
      return decisionFail('CLIENT_SERVICE_ADDRESS_REQUIRED')
    }

    if (!args.clientServiceAddress) {
      return decisionFail('CLIENT_SERVICE_ADDRESS_INVALID')
    }
  }

  if (
    args.locationType === ServiceLocationType.SALON &&
    !args.salonLocationAddress
  ) {
    return decisionFail('SALON_LOCATION_ADDRESS_REQUIRED')
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
    fallbackTimeZone: 'UTC',
  })

  const requestedEnd = slotReadiness.ok
    ? slotReadiness.endUtc
    : computedRequestedEnd

  if (!slotReadiness.ok) {
    return mapSlotReadinessFailure({
      code: slotReadiness.code,
      stepMinutes: args.stepMinutes,
      workingHoursError: slotReadiness.meta?.workingHoursError,
      requestedStart: args.requestedStart,
      requestedEnd,
      meta: slotReadiness.meta,
    })
  }

  const conflict = await getTimeRangeConflict({
    tx: args.tx,
    professionalId: args.professionalId,
    locationId: args.locationId,
    requestedStart: args.requestedStart,
    requestedEnd,
    defaultBufferMinutes: args.bufferMinutes,
    fallbackDurationMinutes: args.durationMinutes,
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

  return decisionOk({
    requestedEnd,
  })
}