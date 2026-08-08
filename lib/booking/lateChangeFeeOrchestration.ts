// lib/booking/lateChangeFeeOrchestration.ts
//
// The post-commit half of a LATE client reschedule, extracted so the authed
// reschedule route and the token reschedule route run the EXACT same policy —
// the same structural guarantee runCancelRefundOrchestration gives the two
// cancel routes, rather than two copies kept honest by hand.
//
// Runs AFTER rescheduleBookingFromHold's locked transaction has committed. The
// write boundary stays DB-only; Stripe effects orchestrate out here, mirroring
// the cancel path.
//
// ── What this does NOT do ─────────────────────────────────────────────────────
// It does not touch the deposit. A late CANCEL forfeits the deposit because the
// booking ends and nothing is refunded; a late RESCHEDULE keeps the appointment,
// so the deposit stays credited against the moved booking's bill (see
// lib/booking/depositCredit — that module exists because a client was once
// billed twice, and un-crediting here would re-create exactly that).
//
// The client is not let off, though: the commit stamped `Booking.lateChangeAt`,
// and both client refund rules read it, so cancelling the moved booking later is
// judged as a LATE cancel — no auto refund, deposit forfeited — regardless of
// how far out the client pushed it. That stamp is what closes the
// reschedule-then-cancel refund hole, and it works with
// ENABLE_NO_SHOW_PROTECTION off. The fee below is the flag-gated deterrent on
// top, sized by the pro's own policy.

import { NoShowFeeReason, NoShowFeeStatus, BookingStatus } from '@prisma/client'

import { assessAndChargeNoShowFee } from '@/lib/noShowProtection/charge'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { safeError } from '@/lib/security/logging'

export type LateChangeFeeSummary = {
  /** Cents actually taken off the card by THIS call; 0 when nothing moved. */
  chargedCents: number
}

const NOTHING_CHARGED: LateChangeFeeSummary = { chargedCents: 0 }

export async function runLateChangeFeeOrchestration(args: {
  bookingId: string
  /**
   * rescheduleBookingFromHold's `lateChangeApplied` — true only when THIS move
   * stamped `lateChangeAt`. A move that was already stamped, or one comfortably
   * outside the window, owes nothing.
   */
  lateChangeApplied: boolean
  /**
   * The booking's start instant BEFORE the move. The window test must run
   * against this, not the row — post-commit the row holds the new time.
   */
  previousScheduledFor: Date
  /** The booking's status at the time of the move; only ACCEPTED is billable. */
  priorStatus: BookingStatus
  /** Route label for the error log on a failed charge. */
  operation: string
}): Promise<LateChangeFeeSummary> {
  if (!args.lateChangeApplied) return NOTHING_CHARGED
  if (!noShowProtectionEnabled()) return NOTHING_CHARGED

  // Best-effort, exactly like the cancel path: the reschedule is already
  // committed, so a charge failure must never fail the request or un-move the
  // booking. A FAILED NoShowFee row + Sentry capture make it retryable.
  const outcome = await assessAndChargeNoShowFee({
    bookingId: args.bookingId,
    reason: NoShowFeeReason.LATE_RESCHEDULE,
    priorStatus: args.priorStatus,
    windowAnchor: args.previousScheduledFor,
  }).catch((error: unknown) => {
    console.error(`${args.operation} late-change fee error`, safeError(error))
    return null
  })

  // Only a freshly SUCCEEDED charge is money that left the card. A
  // FAILED/SKIPPED fee moved nothing, and an idempotent replay must not be
  // reported to the client as a second charge (M6 — never a promise the ledger
  // cannot back).
  if (
    outcome?.kind === 'ATTEMPTED' &&
    outcome.status === NoShowFeeStatus.CHARGED &&
    !outcome.alreadyCharged
  ) {
    return { chargedCents: Math.round(Number(outcome.amount) * 100) }
  }

  return NOTHING_CHARGED
}
