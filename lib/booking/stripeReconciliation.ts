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
// New-client deposits ride a separate PaymentIntent and are reconciled by the
// parallel `reconcileStripeDeposits` sweep below, which re-drives the deposit
// webhook path the same way.
//
// Cost is kept low: one Stripe call (retrieve PaymentIntent) per candidate to
// read the authoritative refunded total; a second call (list refunds) plus a
// DB transaction run ONLY when there is refund activity to settle.

import type Stripe from 'stripe'
import {
  BookingDepositStatus,
  BookingRefundStatus,
  PaymentProvider,
  StripePaymentStatus,
} from '@prisma/client'

import {
  reconcileChargeRefundInTransaction,
  type ChargeRefundReconcileInput,
} from '@/lib/booking/refunds'
import { reconcileDepositChargeRefundInTransaction } from '@/lib/booking/writeBoundary'
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

type ChargeAmounts = {
  stripeRefundedCents: number
  chargeAmountCents: number
}

type RetrievedCharge =
  | { kind: 'ok'; amounts: ChargeAmounts }
  | { kind: 'stripe_lookup_failed' }
  | { kind: 'charge_missing' }

// Shared first step for both the final-bill and deposit paths: ask Stripe for
// the authoritative refunded/charge totals on a PaymentIntent. Failures are
// captured here so each candidate stays isolated from the rest of the sweep.
async function retrieveChargeAmounts(args: {
  paymentIntentId: string
  bookingId: string
  fallbackChargeAmountCents: number
}): Promise<RetrievedCharge> {
  const stripe = getStripe()

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(args.paymentIntentId, {
      expand: ['latest_charge'],
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: ROUTE,
      event: 'STRIPE_LOOKUP_FAILED',
      bookingId: args.bookingId,
    })
    return { kind: 'stripe_lookup_failed' }
  }

  const charge = getLatestCharge(paymentIntent)
  if (!charge) {
    return { kind: 'charge_missing' }
  }

  return {
    kind: 'ok',
    amounts: {
      stripeRefundedCents:
        typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0,
      chargeAmountCents:
        typeof charge.amount === 'number'
          ? charge.amount
          : args.fallbackChargeAmountCents,
    },
  }
}

async function reconcileBooking(candidate: Candidate): Promise<BookingReconcileResult> {
  const base = {
    bookingId: candidate.id,
    paymentIntentId: candidate.stripePaymentIntentId,
    localRefundedCents: candidate.stripeAmountRefunded,
  }

  const retrieved = await retrieveChargeAmounts({
    paymentIntentId: candidate.stripePaymentIntentId,
    bookingId: candidate.id,
    fallbackChargeAmountCents: candidate.stripeAmountTotal ?? 0,
  })
  if (retrieved.kind !== 'ok') {
    return { ...base, outcome: retrieved.kind, stripeRefundedCents: candidate.stripeAmountRefunded }
  }

  const { stripeRefundedCents, chargeAmountCents } = retrieved.amounts

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
    const list = await getStripe().refunds.list({
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

function buildRunResult(
  candidatesScanned: number,
  results: BookingReconcileResult[],
): ReconcileRunResult {
  const tally = results.reduce<Record<ReconcileOutcome, number>>(
    (acc, result) => {
      acc[result.outcome] += 1
      return acc
    },
    { ...EMPTY_TALLY },
  )

  return {
    candidatesScanned,
    capped: candidatesScanned === MAX_BOOKINGS_PER_RUN,
    tally,
    results,
  }
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

  return buildRunResult(candidates.length, results)
}

// ---------------------------------------------------------------------------
// Deposit reconciliation
//
// New-client deposits ride their OWN Stripe PaymentIntent
// (`depositStripePaymentIntentId`), distinct from the final-bill charge above,
// and carry no BookingRefund rows — a deposit is refunded once, in full or part,
// straight on its charge. The webhook path keeps `depositStatus` in sync via
// reconcileDepositChargeRefundInTransaction; this sweep re-drives the SAME path
// for the lost-webhook / Dashboard-refund cases, exactly mirroring the final-bill
// sweep. The deposit PI is independent of the final-bill `paymentProvider`, so we
// filter only on the deposit fields.
// ---------------------------------------------------------------------------

type DepositCandidate = {
  id: string
  depositStripePaymentIntentId: string
  depositStatus: BookingDepositStatus
  depositRefundedCents: number
  depositChargeFallbackCents: number
}

function decimalDollarsToCents(value: { toString(): string } | null): number {
  if (value == null) return 0
  const parsed = Number(value.toString())
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

async function reconcileDepositBooking(
  candidate: DepositCandidate,
): Promise<BookingReconcileResult> {
  const base = {
    bookingId: candidate.id,
    paymentIntentId: candidate.depositStripePaymentIntentId,
    localRefundedCents: candidate.depositRefundedCents,
  }

  const retrieved = await retrieveChargeAmounts({
    paymentIntentId: candidate.depositStripePaymentIntentId,
    bookingId: candidate.id,
    fallbackChargeAmountCents: candidate.depositChargeFallbackCents,
  })
  if (retrieved.kind !== 'ok') {
    return { ...base, outcome: retrieved.kind, stripeRefundedCents: 0 }
  }

  const { stripeRefundedCents, chargeAmountCents } = retrieved.amounts

  // Nothing to heal when: no refund on Stripe; we already recorded at least the
  // Stripe cumulative (partials included, via depositRefundedCents); or the
  // deposit is already fully REFUNDED. The REFUNDED check also covers legacy rows
  // refunded before depositRefundedCents existed (backfilled to 0).
  if (
    stripeRefundedCents === 0 ||
    stripeRefundedCents <= candidate.depositRefundedCents ||
    candidate.depositStatus === BookingDepositStatus.REFUNDED
  ) {
    return { ...base, outcome: 'in_sync', stripeRefundedCents }
  }

  try {
    const result = await prisma.$transaction((tx) =>
      reconcileDepositChargeRefundInTransaction(tx, {
        paymentIntentId: candidate.depositStripePaymentIntentId,
        amountRefundedCents: stripeRefundedCents,
        chargeAmountCents,
      }),
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

  return { ...base, outcome: 'refund_drift_healed', stripeRefundedCents }
}

export async function reconcileStripeDeposits(opts?: { now?: Date }): Promise<ReconcileRunResult> {
  const now = opts?.now ?? new Date()
  const windowStart = new Date(now.getTime() - RECONCILE_WINDOW_DAYS * 24 * 3_600_000)

  const candidates = await prisma.booking.findMany({
    where: {
      depositStripePaymentIntentId: { not: null },
      depositStatus: {
        in: [BookingDepositStatus.PAID, BookingDepositStatus.REFUNDED],
      },
      depositPaidAt: { gte: windowStart },
    },
    select: {
      id: true,
      depositStripePaymentIntentId: true,
      depositStatus: true,
      depositRefundedCents: true,
      depositAmount: true,
    },
    orderBy: { depositPaidAt: 'asc' },
    take: MAX_BOOKINGS_PER_RUN,
  })

  const results: BookingReconcileResult[] = []
  for (const candidate of candidates) {
    if (!candidate.depositStripePaymentIntentId) continue

    results.push(
      await reconcileDepositBooking({
        id: candidate.id,
        depositStripePaymentIntentId: candidate.depositStripePaymentIntentId,
        depositStatus: candidate.depositStatus,
        depositRefundedCents: candidate.depositRefundedCents,
        depositChargeFallbackCents: decimalDollarsToCents(candidate.depositAmount),
      }),
    )
  }

  return buildRunResult(candidates.length, results)
}
