// lib/booking/policies/types.ts

export type PolicyLogConflictType =
  | 'STEP_BOUNDARY'
  | 'WORKING_HOURS'
  | 'TIME_NOT_AVAILABLE'
  | 'BLOCKED'
  | 'BOOKING'
  | 'HOLD'

export type PolicyLogHint = {
  requestedStart: Date
  requestedEnd: Date
  conflictType: PolicyLogConflictType
  meta?: Record<string, unknown>
}

export type SchedulingPolicyFailureCode =
  | 'STEP_MISMATCH'
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'OUTSIDE_WORKING_HOURS'
  | 'ADVANCE_NOTICE_REQUIRED'
  | 'MAX_DAYS_AHEAD_EXCEEDED'
  | 'TIME_BLOCKED'
  | 'TIME_BOOKED'
  | 'TIME_HELD'

export type PolicySuccess<T> = {
  ok: true
  value: T
}

export type PolicyFailure<TCode extends string> = {
  ok: false
  code: TCode
  logHint?: PolicyLogHint
}

export type PolicyResult<T, TCode extends string> =
  | PolicySuccess<T>
  | PolicyFailure<TCode>

export function policyOk<T>(value: T): PolicySuccess<T> {
  return { ok: true, value }
}

export function policyFail<TCode extends string>(
  code: TCode,
  logHint?: PolicyLogHint,
): PolicyFailure<TCode> {
  return {
    ok: false,
    code,
    logHint,
  }
}