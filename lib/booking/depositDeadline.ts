// lib/booking/depositDeadline.ts
//
// Single source of truth for the new-client discovery-deposit lifecycle timing.
// Three sibling jobs read their knobs from here so the windows stay consistent:
//   - the auto-release sweep       (lib/booking/depositReleaseSweep.ts, M5)
//   - the deposit-reminder nudge   (lib/notifications/depositReminders.ts, M5)
//   - the success-recovery sweep   (lib/booking/depositSuccessRecoverySweep.ts, M14)
//
//   deadline  — hours after the booking is created that an unpaid deposit's
//               hold is auto-released. Anchored on Booking.createdAt (the same
//               basis the sweeps age on).
//   lead      — hours BEFORE the deadline that the "finish your deposit" nudge
//               is sent. So the reminder fires at createdAt + (deadline - lead).
//
// All are env-tunable without a deploy-time code change; the defaults below are
// the shipped policy (Tori, 2026-07-22): 24h deadline, reminder 4h before.

import { readOptionalEnv } from '@/lib/env'

export const DEPOSIT_UNPAID_DEADLINE_HOURS_DEFAULT = 24
export const DEPOSIT_REMINDER_LEAD_HOURS_DEFAULT = 4

// M14 — deposit-success recovery sweep knobs.
//   minAge — a lost deposit `payment_intent.succeeded` is first the live
//            webhook's job, then Stripe's native retries'. Give both a head start
//            before the sweep polls; matches stripe-orphan-recovery's 30 min.
//   maxAge — how far back the sweep polls PENDING deposits. Well beyond Stripe's
//            ~3-day native-retry window (which is the M14 gap) so the tail Stripe
//            abandons is still recovered; matches the reconciliation window.
//   stale  — a deposit Stripe confirms captured but we still hold PENDING past
//            this age has outlived the live webhook + native retries: the healing
//            pipeline demonstrably failed, so page even though we auto-recover it.
export const DEPOSIT_RECOVERY_MIN_AGE_MINUTES_DEFAULT = 30
export const DEPOSIT_RECOVERY_MAX_AGE_DAYS_DEFAULT = 45
export const DEPOSIT_RECOVERY_STALE_HOURS_DEFAULT = 72

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = readOptionalEnv(name)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.trunc(parsed)
}

/** Hours after createdAt an unpaid-deposit hold is auto-released. */
export function depositUnpaidDeadlineHours(): number {
  return readPositiveIntEnv(
    'DEPOSIT_UNPAID_DEADLINE_HOURS',
    DEPOSIT_UNPAID_DEADLINE_HOURS_DEFAULT,
  )
}

/**
 * Hours before the deadline the reminder is sent. Clamped below the deadline so
 * a misconfiguration can never schedule the nudge at or after the release — a
 * lead ≥ deadline collapses to "half the deadline" rather than a non-positive
 * offset.
 */
export function depositReminderLeadHours(): number {
  const deadline = depositUnpaidDeadlineHours()
  const lead = readPositiveIntEnv(
    'DEPOSIT_REMINDER_LEAD_HOURS',
    DEPOSIT_REMINDER_LEAD_HOURS_DEFAULT,
  )
  return lead < deadline ? lead : Math.max(1, Math.floor(deadline / 2))
}

/** Milliseconds from createdAt to the reminder send time. */
export function depositReminderOffsetMs(): number {
  return (depositUnpaidDeadlineHours() - depositReminderLeadHours()) * 60 * 60 * 1000
}

/** Milliseconds from createdAt to the auto-release deadline. */
export function depositUnpaidDeadlineMs(): number {
  return depositUnpaidDeadlineHours() * 60 * 60 * 1000
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = readOptionalEnv(name)
  if (raw == null) return fallback
  const v = raw.trim().toLowerCase()
  return v !== 'false' && v !== '0' && v !== 'no' && v !== 'off'
}

/**
 * Kill switch for the auto-release action. Default ON so the feature works once
 * deployed; set DEPOSIT_AUTO_RELEASE_ENABLED=false to stop all releases (the
 * sweep then only observes + logs candidate counts) without a code change.
 */
export function depositAutoReleaseEnabled(): boolean {
  return readBooleanEnv('DEPOSIT_AUTO_RELEASE_ENABLED', true)
}

/**
 * Kill switch for the deposit-success recovery mutation (M14). Default ON so the
 * backstop works once deployed; set DEPOSIT_SUCCESS_RECOVERY_ENABLED=false to
 * make the sweep observe-only — it still polls Stripe (read-only) and logs which
 * PENDING deposits Stripe reports captured (the true first-run blast radius, not
 * just a candidate count), but records nothing.
 */
export function depositSuccessRecoveryEnabled(): boolean {
  return readBooleanEnv('DEPOSIT_SUCCESS_RECOVERY_ENABLED', true)
}

/** Minutes after createdAt before the recovery sweep first polls a PENDING deposit. */
export function depositRecoveryMinAgeMinutes(): number {
  return readPositiveIntEnv(
    'DEPOSIT_RECOVERY_MIN_AGE_MINUTES',
    DEPOSIT_RECOVERY_MIN_AGE_MINUTES_DEFAULT,
  )
}

/** Days back the recovery sweep keeps polling PENDING deposits. */
export function depositRecoveryMaxAgeDays(): number {
  return readPositiveIntEnv(
    'DEPOSIT_RECOVERY_MAX_AGE_DAYS',
    DEPOSIT_RECOVERY_MAX_AGE_DAYS_DEFAULT,
  )
}

/** Age past which a still-PENDING but Stripe-captured deposit pages as stale. */
export function depositRecoveryStaleHours(): number {
  return readPositiveIntEnv(
    'DEPOSIT_RECOVERY_STALE_HOURS',
    DEPOSIT_RECOVERY_STALE_HOURS_DEFAULT,
  )
}
