// lib/booking/depositDeadline.ts
//
// Single source of truth for the new-client discovery-deposit auto-release
// timing (M5). Both the auto-release sweep (lib/booking/depositReleaseSweep.ts)
// and the deposit-reminder scheduler (lib/notifications/depositReminders.ts)
// read these knobs from here, so the nudge can never fire AFTER the deadline it
// is meant to precede.
//
//   deadline  — hours after the booking is created that an unpaid deposit's
//               hold is auto-released. Anchored on Booking.createdAt (the same
//               basis the sweep ages on).
//   lead      — hours BEFORE the deadline that the "finish your deposit" nudge
//               is sent. So the reminder fires at createdAt + (deadline - lead).
//
// Both are env-tunable without a deploy-time code change; the defaults below are
// the shipped policy (Tori, 2026-07-22): 24h deadline, reminder 4h before.

import { readOptionalEnv } from '@/lib/env'

export const DEPOSIT_UNPAID_DEADLINE_HOURS_DEFAULT = 24
export const DEPOSIT_REMINDER_LEAD_HOURS_DEFAULT = 4

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

/**
 * Kill switch for the auto-release action. Default ON so the feature works once
 * deployed; set DEPOSIT_AUTO_RELEASE_ENABLED=false to stop all releases (the
 * sweep then only observes + logs candidate counts) without a code change.
 */
export function depositAutoReleaseEnabled(): boolean {
  const raw = readOptionalEnv('DEPOSIT_AUTO_RELEASE_ENABLED')
  if (raw == null) return true
  const v = raw.trim().toLowerCase()
  return v !== 'false' && v !== '0' && v !== 'no' && v !== 'off'
}
