// lib/booking/stripeReconciliation.ts
//
// Periodic Stripe refund reconciliation.
//
// Webhooks are the primary path that keeps a booking's refund state in sync
// with Stripe (`charge.refunded` -> reconcileChargeRefundInTransaction). But a
// webhook can be lost (transient outage, deploy hiccup) and a refund issued
// straight from the Stripe Dashboard creates no BookingRefund row at all. Both
// leave our ledger behind Stripe: `stripeAmountRefunded` stale, BookingRefund
// rows stuck PENDING, or a fully-refunded booking never flipped to REFUNDED.
//
// This sweep polls Stripe for recently-paid bookings and re-drives the SAME
// reconcile path the webhook uses, so the healing logic lives in exactly one
// place. The re-drive is safe to repeat: `stripeAmountRefunded` advances by
// monotonic max, refund-row updates match on `stripeRefundId`, and refund
// notifications dedupe per refund id.
//
// Cost is kept low: one Stripe call (retrieve PaymentIntent) per candidate to
// read the authoritative refunded total; a second call (list refunds) plus a
// DB transaction run ONLY when there is refund activity to settle.

import type Stripe from 'stripe'
import {
  BookingRefundStatus,
  PaymentProvider,
  StripePaymentStatus,
} from '@prisma/client'

import {
  reconcileChargeRefundInTransaction,
  type ChargeRefundReconcileInput,
} from '@/lib/booking/refunds'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'

const ROUTE = 'GET /api/internal/jobs/stripe-reconciliation'

// Refunds almost always land within days of capture. Bookings older than this
// window are left to webhook-driven state; polling every paid booking forever
// is neither necessary nor cheap.
export const RECONCILE_WINDOW_DAYS = 45

// Safety cap per run. At current volume the candidate set is far smaller; if a
// run ever reaches this, `capped` is surfaced in the response so the truncation
// is never silent (the durable fix is a `stripeReconciledAt` round-robin
// cursor, deferred until scale demands it).
export const MAX_BOOKINGS_PER_RUN = 150

const STRIPE_REFUND_PAGE_SIZE = 100

export type ReconcileOutcome =
  | 'in_sync'
  | 'refund_drift_healed'
  | 'refund_rows_synced'
  | 'charge_missing'
  | 'stripe_lookup_failed'
  | 'reconcile_failed'
  | 'booking_not_found'

export type BookingReconcileResult = {
  bookingId: string
  paymentIntentId: string
  outcome: ReconcileOutcome
  localRefundedCents: number
  stripeRefundedCents: number
}

type Candidate = {
  id: string
  stripePaymentIntentId: string
  stripeAmountTotal: number | null
  stripeAmountRefunded: number
  pendingRefundCount: number
}

const EMPTY_TALLY: Record<ReconcileOutcome, number> = {
  in_sync: 0,
  refund_drift_healed: 0,
  refund_rows_synced: 0,
  charge_missing: 0,
  stripe_lookup_failed: 0,
  reconcile_failed: 0,
  booking_not_found: 0,
}

function getLatestCharge(paymentIntent: Stripe.PaymentIntent): Stripe.Charge | null {
  const charge = paymentIntent.latest_charge
  if (charge && typeof charge === 'object' && charge.object === 'charge') {
    return charge
  }
  return null
}

async function reconcileBooking(candidate: Candidate): Promise<BookingReconcileResult> {
  const stripe = getStripe()
  const base = {
    bookingId: candidate.id,
    paymentIntentId: candidate.stripePaymentIntentId,
    localRefundedCents: candidate.stripeAmountRefunded,
  }

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(candidate.stripePaymentIntentId, {
      expand: ['latest_charge'],
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: ROUTE,
      event: 'STRIPE_LOOKUP_FAILED',
      bookingId: candidate.id,
    })
    return { ...base, outcome: 'stripe_lookup_failed', stripeRefundedCents: candidate.stripeAmountRefunded }
  }

  const charge = getLatestCharge(paymentIntent)
  if (!charge) {
    return { ...base, outcome: 'charge_missing', stripeRefundedCents: candidate.stripeAmountRefunded }
  }

  const stripeRefundedCents =
    typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0
  const chargeAmountCents =
    typeof charge.amount === 'number' ? charge.amount : candidate.stripeAmountTotal ?? 0

  const amountDrift = stripeRefundedCents !== candidate.stripeAmountRefunded
  const hasPendingRows = candidate.pendingRefundCount > 0

  // Stripe and our ledger agree and nothing is in flight: skip the extra Stripe
  // call and the write transaction entirely.
  if (!amountDrift && !hasPendingRows && stripeRefundedCents === 0) {
    return { ...base, outcome: 'in_sync', stripeRefundedCents }
  }

  // Pull the authoritative refund objects so BookingRefund rows can be settled
  // (PENDING -> SUCCEEDED/FAILED) by stripeRefundId, exactly as the
  // charge.refunded webhook does.
  let refunds: ChargeRefundReconcileInput['refunds']
  try {
    const list = await stripe.refunds.list({
      payment_intent: candidate.stripePaymentIntentId,
      limit: STRIPE_REFUND_PAGE_SIZE,
    })
    refunds = list.data.map((refund) => ({
      id: refund.id,
      status: refund.status,
      amountCents: typeof refund.amount === 'number' ? refund.amount : 0,
    }))
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: ROUTE,
      event: 'STRIPE_LOOKUP_FAILED',
      bookingId: candidate.id,
    })
    return { ...base, outcome: 'stripe_lookup_failed', stripeRefundedCents }
  }

  const input: ChargeRefundReconcileInput = {
    paymentIntentId: candidate.stripePaymentIntentId,
    amountRefundedCents: stripeRefundedCents,
    // reconcileChargeRefundInTransaction prefers the booking's own captured
    // total and only falls back to this; pass the local snapshot so the
    // fully-refunded check is correct even when the charge amount is absent.
    chargeAmountCents,
    refunds,
  }

  try {
    const result = await prisma.$transaction((tx) =>
      reconcileChargeRefundInTransaction(tx, input),
    )
    if (!result.handled) {
      return { ...base, outcome: 'booking_not_found', stripeRefundedCents }
    }
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: ROUTE,
      event: 'RECONCILE_FAILED',
      bookingId: candidate.id,
    })
    return { ...base, outcome: 'reconcile_failed', stripeRefundedCents }
  }

  return {
    ...base,
    outcome: amountDrift ? 'refund_drift_healed' : 'refund_rows_synced',
    stripeRefundedCents,
  }
}

export type ReconcileRunResult = {
  candidatesScanned: number
  capped: boolean
  tally: Record<ReconcileOutcome, number>
  results: BookingReconcileResult[]
}

export async function reconcileStripeRefunds(opts?: { now?: Date }): Promise<ReconcileRunResult> {
  const now = opts?.now ?? new Date()
  const windowStart = new Date(now.getTime() - RECONCILE_WINDOW_DAYS * 24 * 3_600_000)

  const candidates = await prisma.booking.findMany({
    where: {
      paymentProvider: PaymentProvider.STRIPE,
      stripePaymentIntentId: { not: null },
      stripePaymentStatus: {
        in: [
          StripePaymentStatus.SUCCEEDED,
          StripePaymentStatus.REFUNDED,
          StripePaymentStatus.DISPUTED,
        ],
      },
      OR: [
        { stripePaidAt: { gte: windowStart } },
        { paymentCollectedAt: { gte: windowStart } },
      ],
    },
    select: {
      id: true,
      stripePaymentIntentId: true,
      stripeAmountTotal: true,
      stripeAmountRefunded: true,
      refunds: {
        where: { status: BookingRefundStatus.PENDING },
        select: { id: true },
      },
    },
    orderBy: { stripePaidAt: 'asc' },
    take: MAX_BOOKINGS_PER_RUN,
  })

  const results: BookingReconcileResult[] = []
  for (const candidate of candidates) {
    if (!candidate.stripePaymentIntentId) continue

    results.push(
      await reconcileBooking({
        id: candidate.id,
        stripePaymentIntentId: candidate.stripePaymentIntentId,
        stripeAmountTotal: candidate.stripeAmountTotal,
        stripeAmountRefunded: candidate.stripeAmountRefunded,
        pendingRefundCount: candidate.refunds.length,
      }),
    )
  }

  const tally = results.reduce<Record<ReconcileOutcome, number>>(
    (acc, result) => {
      acc[result.outcome] += 1
      return acc
    },
    { ...EMPTY_TALLY },
  )

  return {
    candidatesScanned: candidates.length,
    capped: candidates.length === MAX_BOOKINGS_PER_RUN,
    tally,
    results,
  }
}
