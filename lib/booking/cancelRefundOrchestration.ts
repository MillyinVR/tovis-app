// lib/booking/cancelRefundOrchestration.ts
//
// K12: the post-cancel refund sequence, extracted from the authed cancel route
// (app/api/v1/bookings/[id]/cancel) so the token-cancel route runs the EXACT
// same policy — the K12 DoD ("a token-cancel produces exactly the same refund
// outcome as an in-app cancel") enforced structurally, not by two copies kept
// honest by hand.
//
// Runs AFTER cancelBooking's locked transaction has committed. Every leg is
// best-effort by design (a refund failure never un-cancels the booking); the
// summary reports what actually happened (M6 — never a promise the ledger
// can't back).

import { NoShowFeeReason, NoShowFeeStatus, type BookingStatus } from '@prisma/client'

import {
  applyAutoCancelRefund,
  applyDiscoveryDepositCancelRefund,
  summarizeCancelRefund,
  type CancelRefundActorKind,
  type CancelRefundSummary,
} from '@/lib/booking/cancelRefund'
import { assessAndChargeNoShowFee } from '@/lib/noShowProtection/charge'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { safeError } from '@/lib/security/logging'

export async function runCancelRefundOrchestration(args: {
  bookingId: string
  actorKind: CancelRefundActorKind
  /** Null for an unauthenticated token actor (an unclaimed client has no user). */
  actorUserId: string | null
  /** cancelBooking result.meta.mutated — false on an idempotent re-cancel. */
  cancelMutated: boolean
  /** cancelBooking result.priorStatus — the fee assessment keys on it (§18.4). */
  priorStatus: BookingStatus
  /** Route label for the error log on a failed fee charge. */
  operation: string
}): Promise<CancelRefundSummary> {
  // Auto-refund per policy (pro/admin always; client only ≥24h out).
  // Best-effort: never throws, so it can't fail the committed cancel.
  const serviceRefund = await applyAutoCancelRefund({
    bookingId: args.bookingId,
    actorKind: args.actorKind,
    actorUserId: args.actorUserId,
    cancelMutated: args.cancelMutated,
  })

  // New-client discovery deposit + fee refund per policy (pro/admin refund
  // both; client ≥24h refunds deposit, keeps fee; client <24h forfeits).
  const depositRefund = await applyDiscoveryDepositCancelRefund({
    bookingId: args.bookingId,
    actorKind: args.actorKind,
    actorUserId: args.actorUserId,
    cancelMutated: args.cancelMutated,
  })

  // M15 POLICY (Tori 2026-07-24): a forfeited discovery deposit IS the <24h
  // cancellation penalty, so it SUPPRESSES the separate late-cancel fee — a
  // client is never double-penalised for one cancel. The fee still applies when
  // nothing was forfeited (no deposit, or a cancel outside the 24h forfeit line
  // but inside a wider pro window, which refunds the deposit yet still owes the
  // fee).
  const depositForfeited = depositRefund.outcome === 'FORFEITED'

  // Late-cancel fee (Phase 2 revenue protection). Only a CLIENT cancel can
  // incur one, and only when the cancel actually mutated, no deposit was
  // forfeited, and it lands inside the pro's window on a confirmed booking
  // (enforced in assessAndChargeNoShowFee via priorStatus — taken from the
  // cancel's own locked transaction, retiring a separate pre-read TOCTOU,
  // §18.4). Best-effort: a charge failure never blocks the committed
  // cancellation. Inert unless ENABLE_NO_SHOW_PROTECTION is on.
  let lateCancelFeeChargedCents = 0
  const lateCancelFeeActive =
    args.actorKind === 'client' && noShowProtectionEnabled()

  if (lateCancelFeeActive && args.cancelMutated && !depositForfeited) {
    const feeOutcome = await assessAndChargeNoShowFee({
      bookingId: args.bookingId,
      reason: NoShowFeeReason.LATE_CANCEL,
      priorStatus: args.priorStatus,
    }).catch((error: unknown) => {
      console.error(`${args.operation} late-cancel fee error`, safeError(error))
      return null
    })

    // Only a freshly SUCCEEDED charge is money that left the card; surface it
    // in the honest cancel summary (M6). A FAILED/SKIPPED fee moved no money,
    // and an idempotent replay reports the subtotal, not the fee.
    if (
      feeOutcome?.kind === 'ATTEMPTED' &&
      feeOutcome.status === NoShowFeeStatus.CHARGED &&
      !feeOutcome.alreadyCharged
    ) {
      lateCancelFeeChargedCents = Math.round(Number(feeOutcome.amount) * 100)
    }
  }

  // Collapse the service + deposit refund outcomes and any late-cancel fee
  // into one honest, client-facing summary (M6 / M15).
  return summarizeCancelRefund({
    service: serviceRefund,
    deposit: depositRefund,
    lateCancelFeeChargedCents,
  })
}
