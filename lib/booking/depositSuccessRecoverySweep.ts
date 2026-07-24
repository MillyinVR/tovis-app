// lib/booking/depositSuccessRecoverySweep.ts
//
// Recovery sweep for a LOST discovery-deposit success webhook (M14).
//
// The new-client deposit rides its OWN Stripe PaymentIntent
// (`depositStripePaymentIntentId`). When the deposit `payment_intent.succeeded`
// / `checkout.session.completed` webhook is lost outright, nothing local heals
// it: stripe-orphan-recovery keys on `stripeCheckoutSessionId` (the deposit
// attach never writes it), reconcileStripeDeposits selects only
// `depositStatus ∈ {PAID, REFUNDED}` (a lost success stays PENDING), and
// stripe-webhook-requeue replays only persisted-then-failed rows (a never-arrived
// webhook has no row). So the money sits captured at Stripe with
// `depositStatus=PENDING`, healed only by Stripe's ~3-day native retries — and
// once those exhaust, forever invisible. Worse with M5: the deposit-release sweep
// can cancel the "unpaid" hold at the 24h deadline while the money is already
// captured.
//
// This sweep closes that gap the way stripe-orphan-recovery closes it for the
// final bill: for each PENDING deposit whose PaymentIntent we recorded, ask
// Stripe whether the PI actually succeeded, and if so re-drive the SAME webhook
// path (applyStripeDepositSucceededInTransaction), so the healing logic lives in
// exactly one place and the re-drive is idempotent.
//
// It keys on `depositStatus=PENDING` + booking AGE (createdAt), NOT on a Stripe
// event and NOT on the session id (which the deposit attach never records). It
// additionally requires `depositStripePaymentIntentId != null` because that id is
// what we poll Stripe with; a deposit whose attach crashed before writing the PI
// (the D5 crash window) is unrecoverable by any age-based local sweep and folds
// into the same residual the final-bill orphan sweep has — the live webhook's
// metadata.bookingId hint is its only recovery.
//
// M5 coordination: this runs in the SAME */15 job as the deposit-release sweep,
// BEFORE it, so a paid-but-unrecorded deposit is marked PAID before the release
// sweep in that tick considers cancelling the slot. If a PRIOR tick's release
// already cancelled the booking (or the switch below was off while release ran),
// the recovered money lands on a CANCELLED booking: we re-run the cancel's own
// refund policy via applyLateCaptureCancelRefund (the M1 seam) rather than
// blindly leaving it — a SYSTEM release has no refund provenance, so that pages
// for a human. Never marks a slot's money "settled" by fiat.
//
// Safety:
//   - Kill switch DEPOSIT_SUCCESS_RECOVERY_ENABLED (default on). When off, the
//     sweep observes: it still polls Stripe (read-only) and logs which deposits
//     Stripe reports captured (the true first-run blast radius), but records
//     nothing.
//   - Per-run cap MAX_RECOVERIES_PER_RUN, truncation logged.
//   - One Stripe call per candidate; per-candidate failures are isolated and
//     tallied. Never throws.

import { BookingDepositStatus, type Prisma } from '@prisma/client'
import type Stripe from 'stripe'

import { applyLateCaptureCancelRefund } from '@/lib/booking/cancelRefund'
import {
  depositRecoveryMaxAgeDays,
  depositRecoveryMinAgeMinutes,
  depositRecoveryStaleHours,
  depositSuccessRecoveryEnabled,
} from '@/lib/booking/depositDeadline'
import { applyStripeDepositSucceededInTransaction } from '@/lib/booking/writeBoundary'
import {
  captureBookingException,
  captureLostDepositSuccessStale,
} from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { logSweepObservation } from '@/lib/observability/sweepObservation'
import { getStripe } from '@/lib/stripe/server'
import { stripeExpandedId } from '@/lib/stripe/expandable'

export const MAX_RECOVERIES_PER_RUN = 100

const ROUTE = 'GET /api/internal/jobs/deposit-release'

export type DepositRecoveryOutcome =
  // A still-PENDING deposit Stripe confirms captured — recorded PAID this run.
  | 'recovered'
  // …and the booking was already CANCELLED (M5 release beat us): recorded PAID,
  // then settled via applyLateCaptureCancelRefund (refund by the cancel's own
  // policy, or a page for a SYSTEM cancel with no provenance).
  | 'recovered_on_cancelled'
  // A concurrent payer (live webhook) recorded it between our query and our tx.
  | 'already_recorded'
  // Stripe says the deposit PI is NOT captured — genuine abandonment; the
  // deposit-release sweep owns freeing that slot, not us.
  | 'not_captured'
  // Kill switch off: Stripe confirms captured, but we recorded nothing (blast
  // radius only).
  | 'would_recover'
  | 'stripe_lookup_failed'
  | 'apply_failed'
  | 'booking_not_found'

export type DepositRecoveryResult = {
  bookingId: string
  outcome: DepositRecoveryOutcome
}

export type DepositRecoveryRunResult = {
  enabled: boolean
  candidatesScanned: number
  capped: boolean
  recoveredCount: number
  tally: Record<DepositRecoveryOutcome, number>
  results: DepositRecoveryResult[]
}

const EMPTY_TALLY: Record<DepositRecoveryOutcome, number> = {
  recovered: 0,
  recovered_on_cancelled: 0,
  already_recorded: 0,
  not_captured: 0,
  would_recover: 0,
  stripe_lookup_failed: 0,
  apply_failed: 0,
  booking_not_found: 0,
}

const CANDIDATE_SELECT = {
  id: true,
  professionalId: true,
  clientId: true,
  createdAt: true,
  depositStripePaymentIntentId: true,
} satisfies Prisma.BookingSelect

type DepositCandidate = Prisma.BookingGetPayload<{ select: typeof CANDIDATE_SELECT }>

/**
 * Poll Stripe for one PENDING deposit and, if its PaymentIntent is captured,
 * re-drive the deposit-succeeded webhook path. Isolated: never throws, so one
 * bad candidate never blocks the rest of the run.
 */
async function recoverDeposit(args: {
  candidate: DepositCandidate
  enabled: boolean
  staleHours: number
  now: Date
}): Promise<DepositRecoveryOutcome> {
  const { candidate, enabled, staleHours, now } = args
  const paymentIntentId = candidate.depositStripePaymentIntentId
  if (!paymentIntentId) return 'booking_not_found'

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: ROUTE,
      event: 'STRIPE_LOOKUP_FAILED',
      bookingId: candidate.id,
    })
    return 'stripe_lookup_failed'
  }

  // Deposit checkout uses automatic capture, so a paid deposit lands as
  // `succeeded`. Anything else (requires_payment_method, processing, canceled)
  // is an unpaid deposit — genuine abandonment the release sweep owns.
  if (paymentIntent.status !== 'succeeded') {
    return 'not_captured'
  }

  const ageHours = (now.getTime() - candidate.createdAt.getTime()) / 3_600_000
  const isStale = ageHours > staleHours

  // Observe-only: Stripe confirms the money, but the kill switch is off — record
  // nothing, just surface the blast radius (and still page a stale one; a
  // captured deposit we're deliberately NOT recording past the native-retry
  // window is exactly what a human needs to see).
  if (!enabled) {
    if (isStale) {
      captureLostDepositSuccessStale({
        bookingId: candidate.id,
        paymentIntentId,
        ageHours: Number(ageHours.toFixed(2)),
        recovered: false,
      })
    }
    return 'would_recover'
  }

  let applied: Awaited<ReturnType<typeof applyStripeDepositSucceededInTransaction>>
  try {
    applied = await prisma.$transaction((tx) =>
      applyStripeDepositSucceededInTransaction(tx, {
        now,
        stripePaymentIntentId: paymentIntentId,
        chargeId: stripeExpandedId(paymentIntent.latest_charge),
        bookingIdHint: candidate.id,
      }),
    )
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: ROUTE,
      event: 'DEPOSIT_RECOVERY_APPLY_FAILED',
      bookingId: candidate.id,
    })
    if (isStale) {
      // Captured at Stripe, past the native-retry window, and we could not record
      // it — money with no local acknowledgement. Page.
      captureLostDepositSuccessStale({
        bookingId: candidate.id,
        paymentIntentId,
        ageHours: Number(ageHours.toFixed(2)),
        recovered: false,
      })
    }
    return 'apply_failed'
  }

  if (!applied.handled || !applied.bookingId) {
    return 'booking_not_found'
  }

  // A late deposit capture that lands on a booking the release sweep already
  // cancelled must settle by that cancel's own refund policy — the same
  // post-commit seam the live webhook / orphan-recovery use. A SYSTEM release
  // (cancelledByRole=null) has no policy to derive, so this pages
  // (UNKNOWN_CANCEL_PROVENANCE) rather than silently keeping the money. Only on a
  // FRESH record: on `alreadyPaid` a concurrent payer already owns the refund.
  if (!applied.alreadyPaid && applied.capturedOnCancelledBooking) {
    await applyLateCaptureCancelRefund({
      bookingId: applied.bookingId,
      flavor: 'DEPOSIT',
    })
  }

  if (isStale) {
    captureLostDepositSuccessStale({
      bookingId: candidate.id,
      paymentIntentId,
      ageHours: Number(ageHours.toFixed(2)),
      recovered: true,
    })
  }

  return applied.alreadyPaid
    ? 'already_recorded'
    : applied.capturedOnCancelledBooking
      ? 'recovered_on_cancelled'
      : 'recovered'
}

/**
 * Recover discovery deposits whose success webhook was lost: poll Stripe for
 * PENDING deposits with a recorded PaymentIntent, and re-drive the deposit-paid
 * path for any Stripe reports captured. Never throws.
 */
export async function recoverAbandonedDepositSuccesses(opts?: {
  now?: Date
}): Promise<DepositRecoveryRunResult> {
  const now = opts?.now ?? new Date()
  const enabled = depositSuccessRecoveryEnabled()
  const minAgeMinutes = depositRecoveryMinAgeMinutes()
  const maxAgeDays = depositRecoveryMaxAgeDays()
  const staleHours = depositRecoveryStaleHours()

  const createdBefore = new Date(now.getTime() - minAgeMinutes * 60_000)
  const createdAfter = new Date(now.getTime() - maxAgeDays * 24 * 3_600_000)

  const candidates = await prisma.booking.findMany({
    where: {
      depositStatus: BookingDepositStatus.PENDING,
      depositStripePaymentIntentId: { not: null },
      createdAt: { lte: createdBefore, gte: createdAfter },
    },
    select: CANDIDATE_SELECT,
    orderBy: { createdAt: 'asc' },
    take: MAX_RECOVERIES_PER_RUN + 1,
  })

  const capped = candidates.length > MAX_RECOVERIES_PER_RUN
  const batch = capped ? candidates.slice(0, MAX_RECOVERIES_PER_RUN) : candidates

  const tally: Record<DepositRecoveryOutcome, number> = { ...EMPTY_TALLY }
  const results: DepositRecoveryResult[] = []

  for (const candidate of batch) {
    const outcome = await recoverDeposit({ candidate, enabled, staleHours, now })
    tally[outcome] += 1
    results.push({ bookingId: candidate.id, outcome })

    if (outcome === 'recovered' || outcome === 'recovered_on_cancelled') {
      logSweepObservation('deposit_success_recovery', {
        mode: outcome,
        bookingId: candidate.id,
        professionalId: candidate.professionalId,
        clientId: candidate.clientId,
        createdAt: candidate.createdAt.toISOString(),
        ageHours: Number(
          ((now.getTime() - candidate.createdAt.getTime()) / 3_600_000).toFixed(2),
        ),
      })
    }
  }

  if (!enabled) {
    logSweepObservation('deposit_success_recovery', {
      mode: 'observe_only',
      candidatesScanned: batch.length,
      wouldRecover: tally.would_recover,
      capped,
      scannedAt: now.toISOString(),
    })
  }

  if (capped) {
    logSweepObservation('deposit_success_recovery', {
      mode: 'capped',
      cap: MAX_RECOVERIES_PER_RUN,
      candidatesScanned: candidates.length,
      scannedAt: now.toISOString(),
    })
  }

  return {
    enabled,
    candidatesScanned: batch.length,
    capped,
    recoveredCount: tally.recovered + tally.recovered_on_cancelled,
    tally,
    results,
  }
}
