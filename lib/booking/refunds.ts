// lib/booking/refunds.ts
//
// Connect-aware refund service for booking payments. Single chokepoint for every
// refund (automatic cancellation refunds + discretionary pro/admin refunds).
//
// Payment model: checkout creates a DESTINATION charge on the platform account
// (payment_intent_data.transfer_data.destination = the pro's connected account)
// with NO application_fee_amount today. So a refund is a single platform-side
// call on the PaymentIntent with reverse_transfer:true to claw the funds back
// from the pro (client made whole). refund_application_fee is only sent when an
// application fee actually exists, so this stays correct if fees are added later.
//
// Money-correctness invariants:
//   - Only ever refund a genuinely captured Stripe payment.
//   - Never refund more than the remaining (captured − already PENDING/SUCCEEDED).
//   - A per-booking advisory lock serializes concurrent refunds so two callers
//     can't both reserve the same remaining amount.
//   - The Stripe call runs OUTSIDE any DB transaction, made idempotent by a key
//     derived from the reserved BookingRefund row id (safe to retry).

import {
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  PaymentProvider,
  Prisma,
  Role,
  StripePaymentStatus,
  type BookingRefund,
} from '@prisma/client'
import Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'

import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'
import { safeError } from '@/lib/security/logging'
import { emitPaymentRefundedNotifications } from '@/lib/notifications/paymentNotifications'

// Distinct from the schedule lock namespace (scheduleLock.ts = 41021) so refund
// serialization never contends with booking-schedule locks.
const REFUND_LOCK_NAMESPACE = 41022

export type RefundActor = {
  userId: string | null
  role: Role | null
}

export type RefundBookingInput = {
  bookingId: string
  trigger: BookingRefundTrigger
  /** Omit / null => refund the full remaining amount. */
  amountCents?: number | null
  reason?: string | null
  actor?: RefundActor | null
}

export type RefundSkipReason =
  | 'NOT_STRIPE_PAYMENT'
  | 'PAYMENT_NOT_CAPTURED'
  | 'PAYMENT_DISPUTED'
  | 'NOTHING_TO_REFUND'

export type RefundInvalidCode = 'BOOKING_NOT_FOUND' | 'INVALID_AMOUNT'

export type RefundResult =
  | { outcome: 'REFUNDED'; refund: BookingRefund; bookingFullyRefunded: boolean }
  | { outcome: 'SKIPPED'; reason: RefundSkipReason }
  | { outcome: 'INVALID'; code: RefundInvalidCode; message: string }
  | { outcome: 'FAILED'; refund: BookingRefund; message: string }

const REFUNDABLE_BOOKING_SELECT = {
  id: true,
  paymentProvider: true,
  stripePaymentIntentId: true,
  stripePaymentStatus: true,
  stripeAmountTotal: true,
  stripeAmountRefunded: true,
  stripeApplicationFeeAmount: true,
  stripeCurrency: true,
} satisfies Prisma.BookingSelect

type RefundableBooking = Prisma.BookingGetPayload<{
  select: typeof REFUNDABLE_BOOKING_SELECT
}>

const RESERVING_STATUSES: BookingRefundStatus[] = [
  BookingRefundStatus.PENDING,
  BookingRefundStatus.SUCCEEDED,
]

async function lockBookingForRefund(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${REFUND_LOCK_NAMESPACE}::int4,
      hashtext(${bookingId})::int4
    )
  `
}

/** Sum of BookingRefund amounts for the given statuses on a booking. */
async function sumRefundCents(
  tx: Prisma.TransactionClient,
  bookingId: string,
  statuses: BookingRefundStatus[],
): Promise<number> {
  const reserved = await tx.bookingRefund.aggregate({
    where: { bookingId, status: { in: statuses } },
    _sum: { amountCents: true },
  })

  return reserved._sum.amountCents ?? 0
}

function isCapturedStripePayment(booking: RefundableBooking): boolean {
  return (
    booking.paymentProvider === PaymentProvider.STRIPE &&
    booking.stripePaymentStatus === StripePaymentStatus.SUCCEEDED &&
    typeof booking.stripePaymentIntentId === 'string' &&
    booking.stripePaymentIntentId.length > 0 &&
    typeof booking.stripeAmountTotal === 'number' &&
    booking.stripeAmountTotal > 0
  )
}

type Reservation =
  | { kind: 'reserved'; refund: BookingRefund; paymentIntentId: string; refundApplicationFee: boolean }
  | { kind: 'skip'; reason: RefundSkipReason }
  | { kind: 'invalid'; code: RefundInvalidCode; message: string }

/**
 * Validate eligibility, compute the refundable remainder, and atomically reserve
 * a PENDING BookingRefund row under a per-booking advisory lock. Returns the
 * reserved row (no Stripe call yet) or a skip/invalid outcome.
 */
async function reserveRefund(input: RefundBookingInput): Promise<Reservation> {
  return prisma.$transaction(async (tx) => {
    await lockBookingForRefund(tx, input.bookingId)

    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: REFUNDABLE_BOOKING_SELECT,
    })

    if (!booking) {
      return {
        kind: 'invalid',
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found.',
      }
    }

    // A disputed charge has had (or is having) its funds pulled by Stripe and
    // the transfer reversed off the pro. Issuing our own refund on top would
    // double-refund the client and over-claw the pro. Freeze the automated
    // refund path until the dispute resolves (a won dispute restores SUCCEEDED
    // via applyStripeDisputeInTransaction, re-opening refunds). Disputed bookings
    // also fail isCapturedStripePayment below; this explicit branch surfaces the
    // real reason instead of the misleading PAYMENT_NOT_CAPTURED.
    if (booking.stripePaymentStatus === StripePaymentStatus.DISPUTED) {
      return { kind: 'skip', reason: 'PAYMENT_DISPUTED' }
    }

    if (!isCapturedStripePayment(booking)) {
      // Manual/unpaid/not-yet-captured bookings have nothing to refund.
      return {
        kind: 'skip',
        reason:
          booking.paymentProvider !== PaymentProvider.STRIPE
            ? 'NOT_STRIPE_PAYMENT'
            : 'PAYMENT_NOT_CAPTURED',
      }
    }

    const capturedTotal = booking.stripeAmountTotal as number

    // Refunds come from two sources that must BOTH count against the captured
    // total, without double-counting their overlap:
    //   • Rows WE created — PENDING (in flight) + SUCCEEDED (settled).
    //   • Stripe's authoritative cumulative refunded total (`stripeAmountRefunded`,
    //     synced from charge.refunded). This already includes our SUCCEEDED rows
    //     once their webhooks land, PLUS Dashboard/external refunds that never
    //     create a row here.
    // Our SUCCEEDED rows are the overlap, so the Stripe-only (Dashboard) portion
    // is `stripeAmountRefunded − ourSucceeded` (clamped at 0 for webhook lag).
    // reserved = ourReservingRows + dashboardOnly is conservative against an
    // in-flight PENDING refund and a concurrent Dashboard refund at the same time.
    const reservedByRows = await sumRefundCents(
      tx,
      input.bookingId,
      RESERVING_STATUSES,
    )
    const succeededByRows = await sumRefundCents(tx, input.bookingId, [
      BookingRefundStatus.SUCCEEDED,
    ])
    const refundedPerStripe = booking.stripeAmountRefunded ?? 0
    const dashboardOnly = Math.max(0, refundedPerStripe - succeededByRows)
    const reserved = reservedByRows + dashboardOnly
    const remaining = capturedTotal - reserved

    if (remaining <= 0) {
      return { kind: 'skip', reason: 'NOTHING_TO_REFUND' }
    }

    const requested =
      input.amountCents == null ? remaining : Math.trunc(input.amountCents)

    if (!Number.isFinite(requested) || requested <= 0) {
      return {
        kind: 'invalid',
        code: 'INVALID_AMOUNT',
        message: 'Refund amount must be a positive number of cents.',
      }
    }

    if (requested > remaining) {
      return {
        kind: 'invalid',
        code: 'INVALID_AMOUNT',
        message: `Refund amount ${requested} exceeds the remaining refundable ${remaining}.`,
      }
    }

    const applicationFee = booking.stripeApplicationFeeAmount ?? 0
    const refundApplicationFee = applicationFee > 0

    const refund = await tx.bookingRefund.create({
      data: {
        bookingId: input.bookingId,
        amountCents: requested,
        currency: (booking.stripeCurrency ?? 'usd').toLowerCase(),
        status: BookingRefundStatus.PENDING,
        trigger: input.trigger,
        reverseTransfer: true,
        applicationFeeRefunded: false,
        initiatedByUserId: input.actor?.userId ?? null,
        initiatedByRole: input.actor?.role ?? null,
        reason: input.reason ?? null,
        stripePaymentIntentId: booking.stripePaymentIntentId,
      },
    })

    return {
      kind: 'reserved',
      refund,
      paymentIntentId: booking.stripePaymentIntentId as string,
      refundApplicationFee,
    }
  })
}

/**
 * Mark a reserved refund SUCCEEDED and flip the booking to REFUNDED once the
 * cumulative SUCCEEDED amount reaches the captured total. Re-locks the booking so
 * concurrent partial refunds settle the booking status consistently.
 */
async function settleSucceededRefund(args: {
  refundId: string
  bookingId: string
  stripeRefundId: string
  refundApplicationFee: boolean
}): Promise<{ refund: BookingRefund; bookingFullyRefunded: boolean }> {
  return prisma.$transaction(async (tx) => {
    await lockBookingForRefund(tx, args.bookingId)

    const refund = await tx.bookingRefund.update({
      where: { id: args.refundId },
      data: {
        status: BookingRefundStatus.SUCCEEDED,
        stripeRefundId: args.stripeRefundId,
        applicationFeeRefunded: args.refundApplicationFee,
        failureCode: null,
        failureMessage: null,
      },
    })

    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: { stripeAmountTotal: true },
    })

    const succeeded = await tx.bookingRefund.aggregate({
      where: { bookingId: args.bookingId, status: BookingRefundStatus.SUCCEEDED },
      _sum: { amountCents: true },
    })

    const refundedTotal = succeeded._sum.amountCents ?? 0
    const capturedTotal = booking?.stripeAmountTotal ?? 0
    const bookingFullyRefunded = capturedTotal > 0 && refundedTotal >= capturedTotal

    if (bookingFullyRefunded) {
      await tx.booking.update({
        where: { id: args.bookingId },
        data: { stripePaymentStatus: StripePaymentStatus.REFUNDED },
      })
    }

    return { refund, bookingFullyRefunded }
  })
}

async function markFailedRefund(args: {
  refundId: string
  failureCode: string | null
  failureMessage: string
}): Promise<BookingRefund> {
  return prisma.bookingRefund.update({
    where: { id: args.refundId },
    data: {
      status: BookingRefundStatus.FAILED,
      failureCode: args.failureCode,
      failureMessage: args.failureMessage.slice(0, 500),
    },
  })
}

/**
 * Issue (or attempt) a refund against a booking's captured Stripe payment.
 *
 * Returns a structured result; it never throws for the expected money paths:
 *   - REFUNDED: the Stripe refund succeeded.
 *   - SKIPPED:  nothing to refund (not a captured Stripe payment, or already
 *               fully refunded) — benign for the automatic cancellation path.
 *   - INVALID:  caller error (unknown booking, bad amount) — a 4xx for the
 *               discretionary endpoint.
 *   - FAILED:   the Stripe call failed after a row was reserved; the row is
 *               marked FAILED (reservation released) and is retryable.
 */
export async function refundBookingPayment(
  input: RefundBookingInput,
): Promise<RefundResult> {
  const reservation = await reserveRefund(input)

  if (reservation.kind === 'skip') {
    return { outcome: 'SKIPPED', reason: reservation.reason }
  }

  if (reservation.kind === 'invalid') {
    return {
      outcome: 'INVALID',
      code: reservation.code,
      message: reservation.message,
    }
  }

  const { refund, paymentIntentId, refundApplicationFee } = reservation

  let stripeRefund: Stripe.Refund
  try {
    const stripe = getStripe()
    stripeRefund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: refund.amountCents,
        reverse_transfer: true,
        ...(refundApplicationFee ? { refund_application_fee: true } : {}),
        metadata: {
          bookingId: input.bookingId,
          bookingRefundId: refund.id,
          trigger: input.trigger,
        },
      },
      { idempotencyKey: `tovis:refund:${refund.id}` },
    )
  } catch (error) {
    const failureCode =
      error instanceof Stripe.errors.StripeError ? error.code ?? error.type : null
    const failureMessage =
      error instanceof Error ? error.message : 'Unknown Stripe refund error.'

    console.error('refundBookingPayment: Stripe refund failed', {
      bookingId: input.bookingId,
      refundId: refund.id,
      error: safeError(error),
    })
    Sentry.captureException(error)

    const failed = await markFailedRefund({
      refundId: refund.id,
      failureCode,
      failureMessage,
    })

    return { outcome: 'FAILED', refund: failed, message: failureMessage }
  }

  const settled = await settleSucceededRefund({
    refundId: refund.id,
    bookingId: input.bookingId,
    stripeRefundId: stripeRefund.id,
    refundApplicationFee,
  })

  return {
    outcome: 'REFUNDED',
    refund: settled.refund,
    bookingFullyRefunded: settled.bookingFullyRefunded,
  }
}

export type DiscoveryDepositRefundResult =
  | { outcome: 'REFUNDED'; refundAmountCents: number; feeRefunded: boolean }
  | { outcome: 'NOT_ATTEMPTED' }
  | { outcome: 'FAILED'; message: string }

/**
 * Refund a brand-new client's discovery deposit (and, per the caller's policy, the
 * one-time platform fee) on a SEPARATE deposit PaymentIntent. Lives here (the refund
 * owner) so the Booking writes stay inside the allowlisted boundary; cancelRefund.ts
 * computes the policy and calls this. Idempotent: claims the deposit row
 * (PAID -> REFUNDED) before calling Stripe, and a deterministic Stripe idempotency key
 * makes retries safe. Refunding the fee stamps discoveryFeeRefundedAt (refund-reset).
 */
export async function refundDiscoveryDeposit(args: {
  bookingId: string
  paymentIntentId: string
  refundAmountCents: number
  refundFee: boolean
  trigger: BookingRefundTrigger
  actor?: RefundActor | null
  reason?: string | null
  now?: Date
}): Promise<DiscoveryDepositRefundResult> {
  if (args.refundAmountCents <= 0) return { outcome: 'NOT_ATTEMPTED' }

  // Reserve the cents atomically under the per-booking refund lock. The deposit
  // rides one charge (deposit portion + the platform fee as the application
  // fee), so `refundAmountCents` is the amount returned to the customer — exactly
  // what increments Stripe's charge.amount_refunded, the same counter the
  // charge.refunded webhook records. Two guards, cleanly separated (N5):
  //   • over-refund: never return more than `chargeTotal − depositRefundedCents`.
  //   • status flip: depositStatus -> REFUNDED only once the deposit PORTION
  //     (charge − fee) is fully returned; a sub-deposit partial stays PAID and
  //     just accumulates depositRefundedCents, so a later refund isn't blocked.
  const claim = await prisma.$transaction(async (tx) => {
    await lockBookingForRefund(tx, args.bookingId)

    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        depositStatus: true,
        depositAmount: true,
        discoveryFeeAmount: true,
        depositRefundedCents: true,
      },
    })

    // A captured (PAID) deposit is the only refundable state. NONE/PENDING/FAILED
    // never had funds; REFUNDED already returned the full deposit portion.
    if (!booking || booking.depositStatus !== BookingDepositStatus.PAID) {
      return { ok: false as const }
    }

    const depositCents = booking.depositAmount
      ? Math.round(Number(booking.depositAmount) * 100)
      : 0
    const feeCents = booking.discoveryFeeAmount ?? 0
    const chargeTotalCents = depositCents + feeCents
    const alreadyRefunded = booking.depositRefundedCents
    const remaining = chargeTotalCents - alreadyRefunded

    // Nothing left to give back, or this refund would exceed the charge.
    if (remaining <= 0 || args.refundAmountCents > remaining) {
      return { ok: false as const }
    }

    const nextRefunded = alreadyRefunded + args.refundAmountCents
    const depositPortionRefunded = depositCents > 0 && nextRefunded >= depositCents

    await tx.booking.update({
      where: { id: args.bookingId },
      data: {
        depositRefundedCents: nextRefunded,
        ...(depositPortionRefunded
          ? { depositStatus: BookingDepositStatus.REFUNDED }
          : {}),
      },
    })

    return {
      ok: true as const,
      alreadyRefunded,
      depositPortionRefunded,
    }
  })

  if (!claim.ok) return { outcome: 'NOT_ATTEMPTED' }

  try {
    const stripe = getStripe()
    const stripeRefund = await stripe.refunds.create(
      {
        payment_intent: args.paymentIntentId,
        amount: args.refundAmountCents,
        reverse_transfer: true,
        ...(args.refundFee ? { refund_application_fee: true } : {}),
        metadata: {
          bookingId: args.bookingId,
          kind: 'DISCOVERY_DEPOSIT_REFUND',
          trigger: args.trigger,
        },
      },
      // Per-refund key (carries the pre-refund cumulative) so sequential partial
      // deposit refunds don't collide on one booking-scoped key, while a retry of
      // THIS refund stays idempotent.
      {
        idempotencyKey: `tovis:deposit-refund:${args.bookingId}:${claim.alreadyRefunded}`,
      },
    )

    // Refund-reset: stamp the fee as refunded only when we actually returned it.
    // Never clear an existing timestamp (a prior refund may have returned it).
    if (args.refundFee) {
      await prisma.booking.update({
        where: { id: args.bookingId },
        data: { discoveryFeeRefundedAt: args.now ?? new Date() },
      })
    }

    await prisma.bookingRefund.create({
      data: {
        bookingId: args.bookingId,
        amountCents: args.refundAmountCents,
        currency: 'usd',
        status: BookingRefundStatus.SUCCEEDED,
        trigger: args.trigger,
        reverseTransfer: true,
        applicationFeeRefunded: args.refundFee,
        stripeRefundId: stripeRefund.id,
        stripePaymentIntentId: args.paymentIntentId,
        initiatedByUserId: args.actor?.userId ?? null,
        initiatedByRole: args.actor?.role ?? null,
        reason: args.reason ?? null,
      },
    })

    return {
      outcome: 'REFUNDED',
      refundAmountCents: args.refundAmountCents,
      feeRefunded: args.refundFee,
    }
  } catch (error) {
    // Release the reservation so the refund can be retried: roll back the cents
    // and the REFUNDED flip (if this call set it). Under the lock so a concurrent
    // refund sees a consistent counter.
    await prisma
      .$transaction(async (tx) => {
        await lockBookingForRefund(tx, args.bookingId)
        await tx.booking.update({
          where: { id: args.bookingId },
          data: {
            depositRefundedCents: { decrement: args.refundAmountCents },
            ...(claim.depositPortionRefunded
              ? { depositStatus: BookingDepositStatus.PAID }
              : {}),
          },
        })
      })
      .catch(() => {})

    console.error('refundDiscoveryDeposit: Stripe refund failed', {
      bookingId: args.bookingId,
      error: safeError(error),
    })
    Sentry.captureException(error)

    return {
      outcome: 'FAILED',
      message: error instanceof Error ? error.message : 'Deposit refund failed.',
    }
  }
}

function mapStripeRefundStatus(status: string | null): BookingRefundStatus {
  switch (status) {
    case 'succeeded':
      return BookingRefundStatus.SUCCEEDED
    case 'failed':
      return BookingRefundStatus.FAILED
    case 'canceled':
      return BookingRefundStatus.CANCELED
    default:
      // 'pending' | 'requires_action' | unknown
      return BookingRefundStatus.PENDING
  }
}

export type ChargeRefundReconcileInput = {
  paymentIntentId: string
  amountRefundedCents: number
  chargeAmountCents: number
  refunds: ReadonlyArray<{
    id: string
    status: string | null
    amountCents: number
    /**
     * The BookingRefund id we stamped into the Stripe refund's metadata at
     * creation (refundBookingPayment). Lets reconcile re-attach a refund to a row
     * that was reserved but never settled — a crash between reserve→settle strands
     * a PENDING row with a null stripeRefundId that otherwise reserves headroom
     * forever (N3). Null for Dashboard/external refunds (no row to recover).
     */
    bookingRefundId?: string | null
  }>
}

/**
 * Reconcile a Stripe `charge.refunded` webhook against our records. Runs INSIDE
 * the webhook's transaction (tx-scoped, like the other apply*InTransaction
 * handlers). Two jobs:
 *   1. Sync the status of refunds we already track (async pending → succeeded/
 *      failed) by matching stripeRefundId.
 *   2. Keep Booking.stripePaymentStatus accurate even for DASHBOARD-initiated
 *      refunds that have no BookingRefund row — a full refund flips to REFUNDED.
 * (Dashboard refunds are intentionally not itemized into BookingRefund rows; the
 * booking-level status is what downstream reads depend on.)
 */
export async function reconcileChargeRefundInTransaction(
  tx: Prisma.TransactionClient,
  input: ChargeRefundReconcileInput,
): Promise<{ handled: boolean }> {
  const booking = await tx.booking.findUnique({
    where: { stripePaymentIntentId: input.paymentIntentId },
    select: {
      id: true,
      stripeAmountTotal: true,
      stripeAmountRefunded: true,
      stripePaymentStatus: true,
    },
  })

  if (!booking) {
    return { handled: false }
  }

  // Record Stripe's authoritative cumulative refunded total so the refund
  // reservation math sees Dashboard/external refunds that create no
  // BookingRefund row. Monotonic max guards against out-of-order webhooks
  // reporting a stale (smaller) cumulative total.
  const nextRefundedTotal = Math.max(
    booking.stripeAmountRefunded ?? 0,
    input.amountRefundedCents,
  )
  if (nextRefundedTotal !== (booking.stripeAmountRefunded ?? 0)) {
    await tx.booking.update({
      where: { id: booking.id },
      data: { stripeAmountRefunded: nextRefundedTotal },
    })
  }

  for (const refund of input.refunds) {
    const nextStatus = mapStripeRefundStatus(refund.status)

    const matched = await tx.bookingRefund.updateMany({
      where: { bookingId: booking.id, stripeRefundId: refund.id },
      data: { status: nextStatus },
    })

    // N3 recovery: no row carries this Stripe refund id, but the refund's
    // metadata points back at a BookingRefund we reserved. A crash between
    // reserve→settle leaves that row PENDING with a null stripeRefundId,
    // permanently reserving refund headroom. Adopt it here: stamp the real
    // stripeRefundId and settle it. Guarded on `stripeRefundId: null` so we
    // never overwrite a row already tied to a different refund, and scoped to
    // this booking so a stale/foreign metadata id can't cross-claim.
    if (matched.count === 0 && refund.bookingRefundId) {
      await tx.bookingRefund.updateMany({
        where: {
          id: refund.bookingRefundId,
          bookingId: booking.id,
          stripeRefundId: null,
        },
        data: { stripeRefundId: refund.id, status: nextStatus },
      })
    }

    // One refund receipt per Stripe refund id. The dedupeKey carries the refund
    // id, so the cumulative refunds list a `charge.refunded` replay carries never
    // double-notifies.
    if (nextStatus === BookingRefundStatus.SUCCEEDED) {
      await emitPaymentRefundedNotifications({
        tx,
        bookingId: booking.id,
        refundDiscriminator: refund.id,
        amountRefundedCents: refund.amountCents,
      })
    }
  }

  const capturedTotal = booking.stripeAmountTotal ?? input.chargeAmountCents
  const fullyRefunded =
    capturedTotal > 0 && input.amountRefundedCents >= capturedTotal

  if (
    fullyRefunded &&
    booking.stripePaymentStatus !== StripePaymentStatus.REFUNDED
  ) {
    await tx.booking.update({
      where: { id: booking.id },
      data: { stripePaymentStatus: StripePaymentStatus.REFUNDED },
    })
  }

  return { handled: true }
}
