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

import { BookingRefundTrigger, Role } from '@prisma/client'
import * as Sentry from '@sentry/nextjs'

import { prisma } from '@/lib/prisma'
import { refundBookingPayment, type RefundResult } from '@/lib/booking/refunds'
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
