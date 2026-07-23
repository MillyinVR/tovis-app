// lib/booking/cancelRefund.ts
//
// Automatic cancellation-refund policy, fired post-commit from the cancel routes
// (the write boundary stays DB-only; external Stripe effects orchestrate here,
// mirroring how notification sends happen outside the cancel transaction).
//
// Policy (service payment), updated 2026-07-19 — a pro cancel no longer
// auto-refunds. The previous rule ("pro/admin -> auto FULL refund, always") is
// retired; only admin keeps the unconditional refund.
//   - admin cancels              -> auto FULL refund, always
//   - pro cancels                -> NO auto refund (pro discretion)
//   - client cancels >= 24h out  -> auto FULL refund
//   - client cancels  < 24h out  -> NO auto refund (pro/admin discretion, PR 3)
//
// ⚠️ This governs the SERVICE PAYMENT only. The new-client discovery deposit is
// a separate Stripe PaymentIntent with its own policy in
// lib/booking/discoveryDepositPlan.ts, and a pro cancel STILL refunds it in full
// (deposit + fee) — a client should not be out of pocket on a cancellation they
// did not cause. Do not "align" the two; the split is deliberate.
//
// Best-effort: never throws. The cancellation is already committed, so a refund
// failure must not fail the request — the FAILED BookingRefund row + Sentry
// capture make it retryable.

import {
  BookingDepositStatus,
  BookingRefundTrigger,
  BookingStatus,
  Role,
} from '@prisma/client'
import * as Sentry from '@sentry/nextjs'

import { prisma } from '@/lib/prisma'
import {
  refundBookingPayment,
  refundDiscoveryDeposit,
  type RefundResult,
} from '@/lib/booking/refunds'
import { resolveDepositRefundPlan } from '@/lib/booking/discoveryDepositPlan'
import { captureLateCaptureOnCancelledBooking } from '@/lib/observability/bookingEvents'
import { safeError } from '@/lib/security/logging'

export const CLIENT_FULL_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000

export type CancelRefundActorKind = 'client' | 'pro' | 'admin'

export type AutoCancelRefundResult =
  | RefundResult
  | { outcome: 'NOT_ATTEMPTED' }

/**
 * Whether an automatic full refund of the SERVICE PAYMENT applies for this
 * cancellation. An admin cancellation always qualifies; a pro cancellation never
 * does (pro discretion — the discovery deposit refunds on its own policy); a
 * client cancellation qualifies only when it lands at least
 * CLIENT_FULL_REFUND_WINDOW_MS before the appointment.
 *
 * This function is the single home of the actor policy — callers must not
 * re-derive it. `scheduledFor` is read only for a client cancel; pass null when
 * the actor kind cannot depend on it.
 */
export function isAutoCancelRefundEligible(args: {
  actorKind: CancelRefundActorKind
  scheduledFor: Date | null
  now: Date
}): boolean {
  if (args.actorKind === 'admin') {
    return true
  }

  if (args.actorKind === 'pro') {
    return false
  }

  if (!args.scheduledFor) {
    return false
  }

  return (
    args.now.getTime() <=
    args.scheduledFor.getTime() - CLIENT_FULL_REFUND_WINDOW_MS
  )
}

function actorKindToRole(kind: CancelRefundActorKind): Role {
  if (kind === 'pro') return Role.PRO
  if (kind === 'admin') return Role.ADMIN
  return Role.CLIENT
}

export async function applyAutoCancelRefund(args: {
  bookingId: string
  actorKind: CancelRefundActorKind
  actorUserId: string | null
  /** result.meta.mutated — false on an idempotent re-cancel (skip, no double refund). */
  cancelMutated: boolean
  now?: Date
  reason?: string | null
}): Promise<AutoCancelRefundResult> {
  if (!args.cancelMutated) {
    return { outcome: 'NOT_ATTEMPTED' }
  }

  try {
    const now = args.now ?? new Date()

    // Only a client cancel depends on the 24h window, so the scheduledFor read
    // stays conditional; every other actor kind is decided by actor alone. The
    // policy itself lives in isAutoCancelRefundEligible — do not inline it here.
    if (args.actorKind === 'client') {
      const booking = await prisma.booking.findUnique({
        where: { id: args.bookingId },
        select: { scheduledFor: true },
      })

      if (
        !booking ||
        !isAutoCancelRefundEligible({
          actorKind: 'client',
          scheduledFor: booking.scheduledFor,
          now,
        })
      ) {
        return { outcome: 'NOT_ATTEMPTED' }
      }
    } else if (
      !isAutoCancelRefundEligible({
        actorKind: args.actorKind,
        scheduledFor: null,
        now,
      })
    ) {
      return { outcome: 'NOT_ATTEMPTED' }
    }

    const result = await refundBookingPayment({
      bookingId: args.bookingId,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      actor: {
        userId: args.actorUserId,
        role: actorKindToRole(args.actorKind),
      },
      reason:
        args.reason ?? `Automatic refund on ${args.actorKind} cancellation.`,
    })

    if (result.outcome === 'FAILED') {
      // refundBookingPayment already logged + captured; note it at the route layer.
      console.error('applyAutoCancelRefund: refund failed', {
        bookingId: args.bookingId,
        message: result.message,
      })
    }

    return result
  } catch (error) {
    console.error('applyAutoCancelRefund: unexpected error', {
      bookingId: args.bookingId,
      error: safeError(error),
    })
    Sentry.captureException(error)
    return { outcome: 'NOT_ATTEMPTED' }
  }
}

export type DepositCancelRefundResult =
  | { outcome: 'REFUNDED'; refundAmountCents: number; feeRefunded: boolean }
  | { outcome: 'FORFEITED' }
  | { outcome: 'NOT_ATTEMPTED' }
  | { outcome: 'FAILED'; message: string }

/**
 * Refund a brand-new client's discovery deposit (and, per policy, the one-time
 * platform fee) when their booking is cancelled. The deposit is a SEPARATE Stripe
 * PaymentIntent from the final bill, so it can't go through refundBookingPayment —
 * this refunds the deposit PI directly with reverse_transfer, and refund_application_fee
 * only when the fee is being returned. Refunding the fee sets discoveryFeeRefundedAt,
 * which reverts the (client, pro) pair to "new" so the fee re-charges next time.
 *
 * Best-effort: never throws. Idempotent via a per-booking claim + Stripe idempotency key.
 */
export async function applyDiscoveryDepositCancelRefund(args: {
  bookingId: string
  actorKind: CancelRefundActorKind
  actorUserId: string | null
  cancelMutated: boolean
  now?: Date
  reason?: string | null
}): Promise<DepositCancelRefundResult> {
  if (!args.cancelMutated) return { outcome: 'NOT_ATTEMPTED' }

  try {
    const now = args.now ?? new Date()

    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        scheduledFor: true,
        depositStatus: true,
        depositStripePaymentIntentId: true,
        depositAmount: true,
        discoveryFeeAmount: true,
      },
    })

    if (
      !booking ||
      booking.depositStatus !== BookingDepositStatus.PAID ||
      !booking.depositStripePaymentIntentId
    ) {
      return { outcome: 'NOT_ATTEMPTED' }
    }

    const depositCents = booking.depositAmount
      ? Math.round(Number(booking.depositAmount) * 100)
      : 0
    const feeCents = booking.discoveryFeeAmount ?? 0

    const plan = resolveDepositRefundPlan({
      actorKind: args.actorKind,
      depositCents,
      feeCents,
      clientWithinFullRefundWindow: isAutoCancelRefundEligible({
        actorKind: 'client',
        scheduledFor: booking.scheduledFor,
        now,
      }),
    })

    if (plan.refundAmountCents <= 0) {
      // Client cancelled too late: deposit forfeited to the pro, fee kept. The
      // booking is cancelled but the kept fee keeps the pair "established".
      return { outcome: 'FORFEITED' }
    }

    // Booking + refund writes happen in the allowlisted refund owner.
    const result = await refundDiscoveryDeposit({
      bookingId: args.bookingId,
      paymentIntentId: booking.depositStripePaymentIntentId,
      refundAmountCents: plan.refundAmountCents,
      refundFee: plan.refundFee,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      actor: { userId: args.actorUserId, role: actorKindToRole(args.actorKind) },
      reason: args.reason ?? `Deposit refund on ${args.actorKind} cancellation.`,
      now,
    })

    if (result.outcome === 'REFUNDED') {
      return {
        outcome: 'REFUNDED',
        refundAmountCents: result.refundAmountCents,
        feeRefunded: result.feeRefunded,
      }
    }
    if (result.outcome === 'FAILED') {
      return { outcome: 'FAILED', message: result.message }
    }
    return { outcome: 'NOT_ATTEMPTED' }
  } catch (error) {
    console.error('applyDiscoveryDepositCancelRefund: unexpected error', {
      bookingId: args.bookingId,
      error: safeError(error),
    })
    Sentry.captureException(error)
    return { outcome: 'NOT_ATTEMPTED' }
  }
}

export type LateCaptureRefundFlavor = 'DEPOSIT' | 'SERVICE'

/**
 * Who is re-running the cancel policy on a CANCELLED booking:
 *   LATE_CAPTURE — a Stripe success just landed on the cancelled booking
 *                  (webhook / requeue / orphan recovery).
 *   RETRY_SWEEP  — the hourly refund-retry sweep re-driving a FAILED
 *                  auto-cancel refund (M3). Same gates, distinct log identity;
 *                  the sweep owns its own escalation (retries-exhausted alert),
 *                  so per-attempt REFUND_FAILED paging stays with LATE_CAPTURE.
 */
export type LateCaptureRefundSource = 'LATE_CAPTURE' | 'RETRY_SWEEP'

export type LateCaptureCancelRefundResult =
  | AutoCancelRefundResult
  | DepositCancelRefundResult
  | { outcome: 'UNKNOWN_PROVENANCE' }

function cancelRoleToActorKind(role: Role): CancelRefundActorKind {
  if (role === Role.PRO) return 'pro'
  if (role === Role.ADMIN) return 'admin'
  return 'client'
}

/**
 * A Stripe success (service payment or discovery deposit) landed on a booking
 * that was already CANCELLED — webhook delay/outage, requeue replay, or orphan
 * recovery. The cancel-time refund helpers skipped it (the money had not landed
 * locally yet), so this is the one place that knows both facts and must settle
 * them: re-run the SAME policy the cancel ran, decided as of the cancel — actor
 * from `cancelledByRole`, the 24h window evaluated at `cancelledAt`, via the
 * same isAutoCancelRefundEligible / resolveDepositRefundPlan gates. No policy
 * is re-derived here.
 *
 * Fired post-commit by every arrival path (live webhook route, webhook requeue
 * cron, orphan recovery) — Stripe I/O cannot run inside their transactions.
 * Best-effort: never throws. A booking cancelled before the provenance columns
 * existed (or by a system cancel with no acting role) cannot be settled by
 * policy — that alerts for manual resolution, as does a failed refund attempt.
 */
export async function applyLateCaptureCancelRefund(args: {
  bookingId: string
  flavor: LateCaptureRefundFlavor
  source?: LateCaptureRefundSource
}): Promise<LateCaptureCancelRefundResult> {
  const source: LateCaptureRefundSource = args.source ?? 'LATE_CAPTURE'
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: { status: true, cancelledAt: true, cancelledByRole: true },
    })

    if (!booking || booking.status !== BookingStatus.CANCELLED) {
      return { outcome: 'NOT_ATTEMPTED' }
    }

    if (!booking.cancelledAt || !booking.cancelledByRole) {
      captureLateCaptureOnCancelledBooking({
        bookingId: args.bookingId,
        flavor: args.flavor,
        reason: 'UNKNOWN_CANCEL_PROVENANCE',
        detail:
          'Booking is CANCELLED with no cancel provenance (pre-migration cancel or system cancel) — refund policy cannot be derived.',
      })
      return { outcome: 'UNKNOWN_PROVENANCE' }
    }

    const actorKind = cancelRoleToActorKind(booking.cancelledByRole)

    const result =
      args.flavor === 'DEPOSIT'
        ? await applyDiscoveryDepositCancelRefund({
            bookingId: args.bookingId,
            actorKind,
            actorUserId: null,
            cancelMutated: true,
            now: booking.cancelledAt,
            reason: `Deposit refund on payment captured after ${actorKind} cancellation.`,
          })
        : await applyAutoCancelRefund({
            bookingId: args.bookingId,
            actorKind,
            actorUserId: null,
            cancelMutated: true,
            now: booking.cancelledAt,
            reason: `Automatic refund on payment captured after ${actorKind} cancellation.`,
          })

    // Distinct log identity per promise site, so a late-capture settle and a
    // sweep retry are always tellable apart in the logs (and from the
    // cancel-time refund path).
    console.log(
      JSON.stringify({
        level: 'info',
        app: 'tovis',
        namespace: 'payments',
        event:
          source === 'RETRY_SWEEP'
            ? 'auto_cancel_refund_retry'
            : 'late_capture_cancel_refund',
        bookingId: args.bookingId,
        flavor: args.flavor,
        actorKind,
        outcome: result.outcome,
      }),
    )

    // A late-capture failure pages per attempt (no other owner exists at that
    // point). A sweep-retry failure does not: every Stripe failure is already
    // Sentry-captured in the refund service, and the sweep pages once with
    // retries-exhausted when the attempt budget runs out.
    if (result.outcome === 'FAILED' && source === 'LATE_CAPTURE') {
      captureLateCaptureOnCancelledBooking({
        bookingId: args.bookingId,
        flavor: args.flavor,
        reason: 'REFUND_FAILED',
        detail: result.message,
      })
    }

    return result
  } catch (error) {
    console.error('applyLateCaptureCancelRefund: unexpected error', {
      bookingId: args.bookingId,
      error: safeError(error),
    })
    Sentry.captureException(error)
    return { outcome: 'NOT_ATTEMPTED' }
  }
}
