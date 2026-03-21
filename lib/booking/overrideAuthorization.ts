// lib/booking/overrideAuthorization.ts

import { bookingError } from '@/lib/booking/errors'
import type { ProSchedulingAppliedOverride } from '@/lib/booking/policies/proSchedulingPolicy'

type AssertCanUseBookingOverrideArgs = {
  actorUserId: string
  professionalId: string
  rule: ProSchedulingAppliedOverride
}

function assertNonEmptyTrimmed(value: string): boolean {
  return value.trim().length > 0
}

function isSupportedOverrideRule(
  rule: ProSchedulingAppliedOverride,
): boolean {
  switch (rule) {
    case 'ADVANCE_NOTICE':
    case 'MAX_DAYS_AHEAD':
    case 'WORKING_HOURS':
      return true
  }
}

export async function assertCanUseBookingOverride(
  args: AssertCanUseBookingOverrideArgs,
): Promise<void> {
  if (!assertNonEmptyTrimmed(args.actorUserId)) {
    throw bookingError('FORBIDDEN', {
      message: 'Missing actor user id for booking override.',
      userMessage: 'You are not allowed to use booking overrides.',
    })
  }

  if (!assertNonEmptyTrimmed(args.professionalId)) {
    throw bookingError('FORBIDDEN', {
      message: 'Missing professional id for booking override.',
      userMessage: 'You are not allowed to use booking overrides.',
    })
  }

  if (!isSupportedOverrideRule(args.rule)) {
    throw bookingError('FORBIDDEN', {
      message: `Unsupported booking override rule: ${String(args.rule)}`,
      userMessage: 'That override is not allowed.',
    })
  }

  // Current minimum policy:
  // - authenticated pro-side actor id must be present
  // - target professional id must be present
  // - override rule must be one of the explicitly supported rule types
  //
  // Future hardening can extend this seam with:
  // - per-rule permissions
  // - per-professional feature flags
  // - admin/support-only override classes
  // - abuse/rate checks
  return
}