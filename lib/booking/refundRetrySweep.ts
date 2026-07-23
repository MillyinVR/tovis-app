// lib/booking/refundRetrySweep.ts
//
// Bounded retry sweep for FAILED auto-cancel refunds (M3).
//
// A cancellation's automatic refund is deliberately best-effort: the cancel is
// already committed, so a Stripe failure marks the reserved BookingRefund row
// FAILED and returns. Before this sweep, that row was a dead end — the hourly
// reconciliation settles PENDING rows only, no cron re-drove FAILED ones, and
// the client (owed money by the cancel policy) heard nothing forever.
//
// This sweep runs inside the hourly stripe-reconciliation cron, AFTER the
// reconcile phases (so Stripe's authoritative refunded totals are fresh), and
// re-drives each still-dead FAILED auto-cancel refund through the same owners
// that issued it:
//   SERVICE — refundBookingPayment for the full remaining amount. The FAILED
//     row itself proves the cancel policy granted a full refund; the remaining
//     math re-checks current state (dashboard refunds, disputes, partials).
//   DEPOSIT — applyLateCaptureCancelRefund(flavor DEPOSIT, source RETRY_SWEEP),
//     which re-resolves the deposit plan from the cancel's own provenance —
//     the promise site runs the commit site's gate, nothing re-derived here.
//
// Scope and bounds:
//   - AUTO_CANCELLATION rows only. A DISCRETIONARY failure has a human owner:
//     the endpoint 502s with "try again" and the pro/admin can simply re-issue.
//     Auto-retrying a discretionary amount could also double the pro's INTENT
//     (they may have already re-issued a corrected refund).
//   - Only bookings still CANCELLED, with the failed PI still the live PI for
//     its flavor (deposit PI still PAID / service PI still SUCCEEDED).
//   - A pair is retried only while its LATEST refund row is FAILED — a newer
//     SUCCEEDED row (retry worked) or PENDING row (attempt in flight) drops it.
//   - Attempt budget per (booking, PI): MAX_ATTEMPTS total FAILED rows. Every
//     attempt that fails records one more FAILED row, so the rows ARE the
//     attempt counter. Exhausting the budget pages once (at that attempt).
//   - Backoff: SERVICE retries wait RETRY_BACKOFF_MS after the last failure.
//     DEPOSIT retries wait DEPOSIT_RETRY_BACKOFF_MS (> Stripe's 24h idempotency
//     window): the deposit path deliberately reuses its cumulative-carrying
//     idempotency key, so a retry inside the window would replay the cached
//     error — and if the "failure" was actually a lost success response, the
//     >24h wait guarantees the hourly deposit reconcile has healed the counter
//     first, making the re-claim refuse instead of double-refunding.
//   - Window: rows older than RETRY_WINDOW_DAYS are left alone (they stay
//     visible in the money trail and in Sentry). Pre-existing prod rows from
//     before this shipped are surfaced to a human, not silently re-driven
//     months later.

import {
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  BookingStatus,
  StripePaymentStatus,
  type Prisma,
} from '@prisma/client'

import { applyLateCaptureCancelRefund } from '@/lib/booking/cancelRefund'
import { refundBookingPayment } from '@/lib/booking/refunds'
import {
  captureAutoCancelRefundRetriesExhausted,
  captureBookingException,
} from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'

export const RETRY_WINDOW_DAYS = 7
export const MAX_ATTEMPTS = 5
export const MAX_RETRIES_PER_RUN = 25
export const RETRY_BACKOFF_MS = 60 * 60 * 1000 // 1h — next hourly run
export const DEPOSIT_RETRY_BACKOFF_MS = 25 * 60 * 60 * 1000 // > Stripe 24h idempotency TTL

const ROUTE = 'GET /api/internal/jobs/stripe-reconciliation'

export type RefundRetryOutcome =
  | 'retried_succeeded'
  | 'retried_failed'
  | 'retries_exhausted'
  | 'waiting_backoff'
  | 'not_retryable'
  | 'retry_error'

export type RefundRetryResult = {
  bookingId: string
  paymentIntentId: string
  flavor: 'DEPOSIT' | 'SERVICE'
  attempts: number
  outcome: RefundRetryOutcome
}

export type RefundRetryRunResult = {
  pairsScanned: number
  capped: boolean
  tally: Record<RefundRetryOutcome, number>
  results: RefundRetryResult[]
}

const EMPTY_TALLY: Record<RefundRetryOutcome, number> = {
  retried_succeeded: 0,
  retried_failed: 0,
  retries_exhausted: 0,
  waiting_backoff: 0,
  not_retryable: 0,
  retry_error: 0,
}

const RETRY_CANDIDATE_BOOKING_SELECT = {
  status: true,
  stripePaymentIntentId: true,
  stripePaymentStatus: true,
  depositStripePaymentIntentId: true,
  depositStatus: true,
  cancelledAt: true,
  cancelledByRole: true,
} satisfies Prisma.BookingSelect

type CandidateBooking = Prisma.BookingGetPayload<{
  select: typeof RETRY_CANDIDATE_BOOKING_SELECT
}>

type CandidatePair = {
  bookingId: string
  paymentIntentId: string
  booking: CandidateBooking
  latestFailureAt: Date
}

/**
 * Re-drive FAILED auto-cancel refunds that still have no settled outcome.
 * Never throws; per-pair failures are tallied and the rest of the sweep runs.
 */
export async function retryFailedAutoCancelRefunds(opts?: {
  now?: Date
}): Promise<RefundRetryRunResult> {
  const now = opts?.now ?? new Date()
  const windowStart = new Date(now.getTime() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const failedRows = await prisma.bookingRefund.findMany({
    where: {
      status: BookingRefundStatus.FAILED,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      createdAt: { gte: windowStart },
      stripePaymentIntentId: { not: null },
      booking: { status: BookingStatus.CANCELLED },
    },
    select: {
      bookingId: true,
      stripePaymentIntentId: true,
      createdAt: true,
      booking: { select: RETRY_CANDIDATE_BOOKING_SELECT },
    },
    orderBy: { createdAt: 'asc' },
  })

  // The window bounds DISCOVERY only (which pairs are still worth looking at);
  // the attempt budget below is counted all-time, so rows aging out of the
  // window can never quietly re-open a spent budget.
  const pairs = new Map<string, CandidatePair>()
  for (const row of failedRows) {
    const paymentIntentId = row.stripePaymentIntentId as string
    const key = `${row.bookingId}:${paymentIntentId}`
    const existing = pairs.get(key)
    if (existing) {
      if (row.createdAt > existing.latestFailureAt) {
        existing.latestFailureAt = row.createdAt
      }
    } else {
      pairs.set(key, {
        bookingId: row.bookingId,
        paymentIntentId,
        booking: row.booking,
        latestFailureAt: row.createdAt,
      })
    }
  }

  const allPairs = [...pairs.values()]
  const capped = allPairs.length > MAX_RETRIES_PER_RUN
  const candidates = allPairs.slice(0, MAX_RETRIES_PER_RUN)

  if (capped) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        app: 'tovis',
        namespace: 'payments',
        event: 'auto_cancel_refund_retry_capped',
        totalPairs: allPairs.length,
        cap: MAX_RETRIES_PER_RUN,
      }),
    )
  }

  const tally = { ...EMPTY_TALLY }
  const results: RefundRetryResult[] = []

  for (const pair of candidates) {
    const result = await retryPair(pair, now)
    tally[result.outcome] += 1
    results.push(result)
  }

  return { pairsScanned: allPairs.length, capped, tally, results }
}

function classifyFlavor(pair: CandidatePair): 'DEPOSIT' | 'SERVICE' | null {
  const { booking, paymentIntentId } = pair
  if (paymentIntentId === booking.depositStripePaymentIntentId) return 'DEPOSIT'
  if (paymentIntentId === booking.stripePaymentIntentId) return 'SERVICE'
  // The booking's PI moved on (superseded checkout session) — this row's charge
  // is no longer the live payment for either flavor; leave it to a human.
  return null
}

async function retryPair(pair: CandidatePair, now: Date): Promise<RefundRetryResult> {
  const flavor = classifyFlavor(pair)
  const base = {
    bookingId: pair.bookingId,
    paymentIntentId: pair.paymentIntentId,
    attempts: 0,
  }

  if (!flavor) {
    return { ...base, flavor: 'SERVICE', outcome: 'not_retryable' }
  }

  try {
    // All-time attempt count for this pair — every failed attempt (original +
    // each retry) recorded one FAILED row, so the rows are the counter.
    const attempts = await prisma.bookingRefund.count({
      where: {
        bookingId: pair.bookingId,
        stripePaymentIntentId: pair.paymentIntentId,
        status: BookingRefundStatus.FAILED,
        trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      },
    })
    base.attempts = attempts

    if (attempts >= MAX_ATTEMPTS) {
      // Budget already spent (the exhausting attempt paged when it failed) —
      // never silently keep moving money on a booking this sick.
      return { ...base, flavor, outcome: 'retries_exhausted' }
    }

    const backoffMs =
      flavor === 'DEPOSIT' ? DEPOSIT_RETRY_BACKOFF_MS : RETRY_BACKOFF_MS
    if (now.getTime() - pair.latestFailureAt.getTime() < backoffMs) {
      return { ...base, flavor, outcome: 'waiting_backoff' }
    }

    // Only retry while the pair's refund history still ENDS in failure. A newer
    // SUCCEEDED row means a retry (or a human) already settled it; a newer
    // PENDING row is an attempt in flight (or an N3 strand the reconcile sweep
    // owns). Checked per-pair right before acting so an hour-old snapshot can't
    // race a settle that happened mid-run.
    const latest = await prisma.bookingRefund.findFirst({
      where: { bookingId: pair.bookingId, stripePaymentIntentId: pair.paymentIntentId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    })
    if (latest?.status !== BookingRefundStatus.FAILED) {
      return { ...base, flavor, outcome: 'not_retryable' }
    }

    if (flavor === 'DEPOSIT') {
      // The deposit re-drive needs the cancel's provenance to re-resolve the
      // deposit plan; without it nothing can decide the fee split — leave the
      // row to a human (the original failure was already Sentry-captured).
      if (
        pair.booking.depositStatus !== BookingDepositStatus.PAID ||
        !pair.booking.cancelledAt ||
        !pair.booking.cancelledByRole
      ) {
        return { ...base, flavor, outcome: 'not_retryable' }
      }

      const result = await applyLateCaptureCancelRefund({
        bookingId: pair.bookingId,
        flavor: 'DEPOSIT',
        source: 'RETRY_SWEEP',
      })

      return finishAttempt(pair, flavor, attempts, result.outcome, extractMessage(result))
    }

    if (pair.booking.stripePaymentStatus !== StripePaymentStatus.SUCCEEDED) {
      // REFUNDED (settled elsewhere) or DISPUTED (frozen) — not ours to move.
      return { ...base, flavor, outcome: 'not_retryable' }
    }

    const result = await refundBookingPayment({
      bookingId: pair.bookingId,
      trigger: BookingRefundTrigger.AUTO_CANCELLATION,
      reason: `Automatic retry of failed cancellation refund (attempt ${attempts + 1}).`,
    })

    return finishAttempt(pair, flavor, attempts, result.outcome, extractMessage(result))
  } catch (error) {
    captureBookingException({
      error,
      route: ROUTE,
      event: 'AUTO_CANCEL_REFUND_RETRY_ERROR',
      bookingId: pair.bookingId,
    })
    return { ...base, flavor, outcome: 'retry_error' }
  }
}

function extractMessage(result: { outcome: string; message?: string }): string | null {
  return typeof result.message === 'string' ? result.message : null
}

function finishAttempt(
  pair: CandidatePair,
  flavor: 'DEPOSIT' | 'SERVICE',
  priorAttempts: number,
  outcome: string,
  message: string | null,
): RefundRetryResult {
  const base = {
    bookingId: pair.bookingId,
    paymentIntentId: pair.paymentIntentId,
    flavor,
  }

  if (outcome === 'REFUNDED') {
    return { ...base, attempts: priorAttempts, outcome: 'retried_succeeded' }
  }

  if (outcome === 'FAILED') {
    const attempts = priorAttempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      captureAutoCancelRefundRetriesExhausted({
        bookingId: pair.bookingId,
        paymentIntentId: pair.paymentIntentId,
        flavor,
        attempts,
        detail: message,
      })
      return { ...base, attempts, outcome: 'retries_exhausted' }
    }
    return { ...base, attempts, outcome: 'retried_failed' }
  }

  // SKIPPED / NOT_ATTEMPTED / FORFEITED / INVALID / UNKNOWN_PROVENANCE — the
  // refund owners' own gates refused; there is nothing (left) to move.
  return { ...base, attempts: priorAttempts, outcome: 'not_retryable' }
}
