// lib/booking/cancelRefund.ts
//
// Automatic cancellation-refund policy, fired post-commit from the cancel routes
// (the write boundary stays DB-only; external Stripe effects orchestrate here,
// mirroring how notification sends happen outside the cancel transaction).
//
// Policy:
//   - pro / admin cancels        -> auto FULL refund, always (not the client's fault)
//   - client cancels >= 24h out  -> auto FULL refund
//   - client cancels  < 24h out  -> NO auto refund (pro/admin discretion, PR 3)
//
// Best-effort: never throws. The cancellation is already committed, so a refund
// failure must not fail the request — the FAILED BookingRefund row + Sentry
// capture make it retryable.

import {
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  Role,
} from '@prisma/client'
import * as Sentry from '@sentry/nextjs'

import { prisma } from '@/lib/prisma'
import { refundBookingPayment, type RefundResult } from '@/lib/booking/refunds'
import { resolveDepositRefundPlan } from '@/lib/booking/discoveryDepositPlan'
import { getStripe } from '@/lib/stripe/server'
import { safeError } from '@/lib/security/logging'

export const CLIENT_FULL_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000

export type CancelRefundActorKind = 'client' | 'pro' | 'admin'

export type AutoCancelRefundResult =
  | RefundResult
  | { outcome: 'NOT_ATTEMPTED' }

/**
 * Whether an automatic full refund applies for this cancellation. Pro/admin
 * cancellations always qualify; a client cancellation qualifies only when it
 * lands at least CLIENT_FULL_REFUND_WINDOW_MS before the appointment.
 */
export function isAutoCancelRefundEligible(args: {
  actorKind: CancelRefundActorKind
  scheduledFor: Date
  now: Date
}): boolean {
  if (args.actorKind === 'pro' || args.actorKind === 'admin') {
    return true
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

    // Pro/admin always qualify; only a client cancel needs the 24h-window check,
    // so the scheduledFor read is skipped otherwise.
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

    // Claim atomically so a re-cancel can't double-refund.
    const claimed = await prisma.booking.updateMany({
      where: { id: args.bookingId, depositStatus: BookingDepositStatus.PAID },
      data: { depositStatus: BookingDepositStatus.REFUNDED },
    })
    if (claimed.count !== 1) return { outcome: 'NOT_ATTEMPTED' }

    const paymentIntentId = booking.depositStripePaymentIntentId

    try {
      const stripe = getStripe()
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: plan.refundAmountCents,
          reverse_transfer: true,
          ...(plan.refundFee ? { refund_application_fee: true } : {}),
          metadata: {
            bookingId: args.bookingId,
            kind: 'DISCOVERY_DEPOSIT_REFUND',
            actorKind: args.actorKind,
          },
        },
        { idempotencyKey: `tovis:deposit-refund:${args.bookingId}` },
      )

      await prisma.booking.update({
        where: { id: args.bookingId },
        // Refund-reset: only stamp the fee as refunded when we actually returned it.
        data: { discoveryFeeRefundedAt: plan.refundFee ? now : null },
      })

      await prisma.bookingRefund.create({
        data: {
          bookingId: args.bookingId,
          amountCents: plan.refundAmountCents,
          currency: 'usd',
          status: BookingRefundStatus.SUCCEEDED,
          trigger: BookingRefundTrigger.AUTO_CANCELLATION,
          reverseTransfer: true,
          applicationFeeRefunded: plan.refundFee,
          stripeRefundId: refund.id,
          stripePaymentIntentId: paymentIntentId,
          initiatedByUserId: args.actorUserId,
          initiatedByRole: actorKindToRole(args.actorKind),
          reason:
            args.reason ?? `Deposit refund on ${args.actorKind} cancellation.`,
        },
      })

      return {
        outcome: 'REFUNDED',
        refundAmountCents: plan.refundAmountCents,
        feeRefunded: plan.refundFee,
      }
    } catch (error) {
      // Release the claim so the refund can be retried.
      await prisma.booking
        .updateMany({
          where: {
            id: args.bookingId,
            depositStatus: BookingDepositStatus.REFUNDED,
            discoveryFeeRefundedAt: null,
          },
          data: { depositStatus: BookingDepositStatus.PAID },
        })
        .catch(() => {})

      console.error('applyDiscoveryDepositCancelRefund: Stripe refund failed', {
        bookingId: args.bookingId,
        error: safeError(error),
      })
      Sentry.captureException(error)

      return {
        outcome: 'FAILED',
        message: error instanceof Error ? error.message : 'Deposit refund failed.',
      }
    }
  } catch (error) {
    console.error('applyDiscoveryDepositCancelRefund: unexpected error', {
      bookingId: args.bookingId,
      error: safeError(error),
    })
    Sentry.captureException(error)
    return { outcome: 'NOT_ATTEMPTED' }
  }
}
