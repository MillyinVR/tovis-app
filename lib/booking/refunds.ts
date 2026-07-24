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
//   - Refund accounting is scoped PER PaymentIntent: the discovery deposit's
//     rows never count against the final bill's remainder (or vice versa).
//   - A per-booking advisory lock serializes concurrent refunds so two callers
//     can't both reserve the same remaining amount.
//   - The Stripe call runs OUTSIDE any DB transaction, made idempotent by a key
//     derived from the reserved BookingRefund row id (safe to retry).

import {
  BookingDepositStatus,
  BookingRefundStatus,
  BookingRefundTrigger,
  NoShowFeeStatus,
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
import {
  buildAuxRefundDiscriminator,
  emitPaymentRefundedNotifications,
} from '@/lib/notifications/paymentNotifications'
import { noShowFeeAmountToCents } from '@/lib/noShowProtection/fee'

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

/**
 * Sum of BookingRefund amounts for the given statuses on a booking, scoped to
 * one PaymentIntent. A booking can carry refund rows for TWO charges — the
 * final-bill PI and the separate discovery-deposit PI — and each PI's
 * reservation math must only ever count its own rows: a SUCCEEDED deposit
 * refund must not shrink the service payment's refundable remainder.
 */
async function sumRefundCents(
  tx: Prisma.TransactionClient,
  bookingId: string,
  paymentIntentId: string,
  statuses: BookingRefundStatus[],
): Promise<number> {
  const reserved = await tx.bookingRefund.aggregate({
    where: { bookingId, stripePaymentIntentId: paymentIntentId, status: { in: statuses } },
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
    const paymentIntentId = booking.stripePaymentIntentId as string

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
      paymentIntentId,
      RESERVING_STATUSES,
    )
    const succeededByRows = await sumRefundCents(tx, input.bookingId, paymentIntentId, [
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
      paymentIntentId,
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
  paymentIntentId: string
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
      select: { stripeAmountTotal: true, stripePaymentIntentId: true },
    })

    const succeeded = await sumRefundCents(tx, args.bookingId, args.paymentIntentId, [
      BookingRefundStatus.SUCCEEDED,
    ])

    const capturedTotal = booking?.stripeAmountTotal ?? 0
    // stripeAmountTotal describes the booking's CURRENT final-bill PI; only
    // compare (and only flip the booking-level status) when the refund we just
    // settled belongs to that PI — deposit rows and rows from a superseded
    // checkout must never flip the live payment to REFUNDED.
    const bookingFullyRefunded =
      booking?.stripePaymentIntentId === args.paymentIntentId &&
      capturedTotal > 0 &&
      succeeded >= capturedTotal

    if (bookingFullyRefunded) {
      await tx.booking.update({
        where: { id: args.bookingId },
        data: { stripePaymentStatus: StripePaymentStatus.REFUNDED },
      })
    }

    return { refund, bookingFullyRefunded }
  })
}

/**
 * Read a Stripe failure into the two columns every FAILED BookingRefund row
 * carries. `failureCode` is Stripe's own code (falling back to its error type)
 * and is null for a non-Stripe throw; `failureMessage` falls back to the caller's
 * path-specific sentence when the thrown value isn't an Error at all. Every
 * refund path needs exactly this pair, so it is read once here.
 */
function describeStripeRefundFailure(
  error: unknown,
  fallbackMessage: string,
): { failureCode: string | null; failureMessage: string } {
  return {
    failureCode:
      error instanceof Stripe.errors.StripeError ? error.code ?? error.type : null,
    failureMessage: error instanceof Error ? error.message : fallbackMessage,
  }
}

/**
 * Emit the M6 refund receipt for a refund THIS process just completed, so the
 * client hears about it at the moment the money moves rather than waiting on
 * Stripe's `charge.refunded` webhook (which, because we already advanced the
 * cumulative counter, will see no rise and stay silent — see
 * buildAuxRefundDiscriminator).
 *
 * Best-effort by design: the refund has already succeeded at Stripe and in the
 * DB, so a receipt failure must never unwind it or surface as a failed refund. It
 * pages instead. `logLabel` keeps each caller's log identity distinct.
 */
async function emitRefundReceiptBestEffort(args: {
  bookingId: string
  refundDiscriminator: string
  amountRefundedCents: number
  logLabel: string
}): Promise<void> {
  try {
    await prisma.$transaction((tx) =>
      emitPaymentRefundedNotifications({
        tx,
        bookingId: args.bookingId,
        refundDiscriminator: args.refundDiscriminator,
        amountRefundedCents: args.amountRefundedCents,
      }),
    )
  } catch (notifyError) {
    console.error(`${args.logLabel}: refund receipt emit failed`, {
      bookingId: args.bookingId,
      error: safeError(notifyError),
    })
    Sentry.captureException(notifyError)
  }
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
    const { failureCode, failureMessage } = describeStripeRefundFailure(
      error,
      'Unknown Stripe refund error.',
    )

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
    paymentIntentId,
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
        depositDisputedAt: true,
      },
    })

    // A captured (PAID) deposit is the only refundable state. NONE/PENDING/FAILED
    // never had funds; REFUNDED already returned the full deposit portion.
    if (!booking || booking.depositStatus !== BookingDepositStatus.PAID) {
      return { ok: false as const }
    }

    // A disputed deposit charge has had (or is having) its funds pulled by Stripe
    // via the chargeback, and the transfer reversed off the pro. Issuing our own
    // refund on top would double-return the deposit and over-claw the pro. Freeze
    // the automated deposit refund until the dispute resolves — a WON dispute
    // clears depositDisputedAt (applyStripeDepositDisputeInTransaction), re-opening
    // refunds; a LOST dispute keeps it frozen forever (the money is already gone).
    // Mirrors reserveRefund's DISPUTED gate on the final-bill PI (M4).
    if (booking.depositDisputedAt) {
      return { ok: false as const, disputed: true as const }
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

  if (!claim.ok) {
    if (claim.disputed) {
      // The freeze fired: a refund was requested against a deposit whose charge
      // is under (or lost) a Stripe dispute. Benign — the dispute already paged
      // (captureStripeDisputeAlert) — but log it with a distinct identity so the
      // refusal is visible and not mistaken for "nothing to refund".
      console.warn(
        JSON.stringify({
          level: 'warn',
          app: 'tovis',
          namespace: 'payments',
          event: 'deposit_refund_frozen_disputed',
          bookingId: args.bookingId,
          paymentIntentId: args.paymentIntentId,
          trigger: args.trigger,
        }),
      )
    }
    return { outcome: 'NOT_ATTEMPTED' }
  }

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

    // Refund-reset + the SUCCEEDED row, recorded atomically. (Refund-reset stamps
    // the fee as refunded only when we actually returned it; never clears an
    // existing timestamp — a prior refund may have returned it.)
    await prisma.$transaction(async (tx) => {
      if (args.refundFee) {
        await tx.booking.update({
          where: { id: args.bookingId },
          data: { discoveryFeeRefundedAt: args.now ?? new Date() },
        })
      }

      await tx.bookingRefund.create({
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
    })

    // Client + pro refund receipt (M6). A SUCCESSFUL cancel-time deposit refund
    // used to notify NO ONE: this path advances depositRefundedCents in the claim
    // tx above, so when the deposit `charge.refunded` webhook later lands,
    // reconcileDepositChargeRefundInTransaction sees no cumulative rise and stays
    // silent — and refundDiscoveryDeposit itself never emitted. The client was
    // refunded in silence. Emit it here (covers every caller: cancel, M1
    // late-capture, M3 retry sweep), best-effort so a receipt failure can never
    // unwind a completed refund, with a discriminator that carries the post-refund
    // cumulative — identical to what the webhook would use — so any replay dedupes.
    const refundedCumulativeCents = claim.alreadyRefunded + args.refundAmountCents
    await emitRefundReceiptBestEffort({
      bookingId: args.bookingId,
      refundDiscriminator: buildAuxRefundDiscriminator({
        kind: 'deposit',
        paymentIntentId: args.paymentIntentId,
        cumulativeRefundedCents: refundedCumulativeCents,
      }),
      amountRefundedCents: args.refundAmountCents,
      logLabel: 'refundDiscoveryDeposit',
    })

    return {
      outcome: 'REFUNDED',
      refundAmountCents: args.refundAmountCents,
      feeRefunded: args.refundFee,
    }
  } catch (error) {
    const { failureCode, failureMessage } = describeStripeRefundFailure(
      error,
      'Deposit refund failed.',
    )

    // Release the reservation so the refund can be retried — roll back the
    // cents and the REFUNDED flip (if this call set it) — and record a durable
    // FAILED row in the SAME transaction: the rollback alone leaves no trace,
    // which made a failed deposit refund invisible to the money trail and
    // unreachable for the retry sweep (M3). Under the lock so a concurrent
    // refund sees a consistent counter.
    try {
      await prisma.$transaction(async (tx) => {
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
        await tx.bookingRefund.create({
          data: {
            bookingId: args.bookingId,
            amountCents: args.refundAmountCents,
            currency: 'usd',
            status: BookingRefundStatus.FAILED,
            trigger: args.trigger,
            reverseTransfer: true,
            applicationFeeRefunded: false,
            initiatedByUserId: args.actor?.userId ?? null,
            initiatedByRole: args.actor?.role ?? null,
            reason: args.reason ?? null,
            stripePaymentIntentId: args.paymentIntentId,
            failureCode,
            failureMessage: failureMessage.slice(0, 500),
          },
        })
      })
    } catch (rollbackError) {
      // Double fault: the claim rollback itself failed. depositRefundedCents is
      // stranded claiming cents the client never received, and no FAILED row
      // exists for the sweep to retry — a human must reconcile this booking.
      console.error('refundDiscoveryDeposit: reservation rollback failed', {
        bookingId: args.bookingId,
        error: safeError(rollbackError),
      })
      Sentry.captureException(rollbackError)
    }

    console.error('refundDiscoveryDeposit: Stripe refund failed', {
      bookingId: args.bookingId,
      error: safeError(error),
    })
    Sentry.captureException(error)

    return {
      outcome: 'FAILED',
      message: failureMessage,
    }
  }
}

export type NoShowFeeRefundCode =
  | 'NO_SHOW_FEE_NOT_REFUNDABLE'
  | 'NO_SHOW_FEE_ALREADY_REFUNDED'
  | 'NO_SHOW_FEE_REFUND_FROZEN_DISPUTED'

export type NoShowFeeRefundResult =
  | { outcome: 'REFUNDED'; refundAmountCents: number }
  | { outcome: 'NOT_ATTEMPTED'; code: NoShowFeeRefundCode }
  | { outcome: 'FAILED'; message: string }

/**
 * Refund a CHARGED no-show / late-cancel fee on its OWN PaymentIntent (M15 GAP A).
 * The fee rides a destination charge distinct from the final-bill PI and the
 * deposit PI (lib/noShowProtection/charge.ts), so this is the WRITE mirror of the
 * GAP B read/reconcile: it advances `noShowFeeRefundedCents` and flips the fee to
 * REFUNDED, then reverses the charge on Stripe with `reverse_transfer:true` to
 * claw the fee back off the pro (the fee charge carries no application fee, so
 * `refund_application_fee` is never needed).
 *
 * Full-refund-only: a pro who charged a client in error returns the WHOLE
 * remaining fee (one small charge — a partial split buys nothing here, and
 * "give it all back" is the only discretionary remedy). Idempotent: claims the
 * fee row (CHARGED -> REFUNDED) before calling Stripe under the per-booking refund
 * lock, and a deterministic idempotency key carrying the pre-refund cumulative
 * makes retries safe. Emits the refund receipt itself with GAP B's exact
 * discriminator so the later `charge.refunded` webhook sees no cumulative rise and
 * stays silent (never double-notifies) — mirrors refundDiscoveryDeposit.
 *
 * REFUSES (NOT_ATTEMPTED) when the fee never moved money (not CHARGED — a FAILED
 * fee is waived, not refunded), is already fully refunded, or is frozen under a
 * Stripe dispute (a chargeback already pulled the funds — our refund on top would
 * double-return; mirrors the deposit dispute freeze).
 */
export async function refundNoShowFee(args: {
  bookingId: string
  actor?: RefundActor | null
  reason?: string | null
}): Promise<NoShowFeeRefundResult> {
  // Reserve the refund atomically under the per-booking refund lock: read the fee
  // state, then flip CHARGED -> REFUNDED and advance the cumulative refunded cents
  // in the SAME transaction so a concurrent caller can't both claim the fee.
  const claim = await prisma.$transaction(async (tx) => {
    await lockBookingForRefund(tx, args.bookingId)

    const booking = await tx.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        noShowFeeStatus: true,
        noShowFeeAmount: true,
        noShowFeeRefundedCents: true,
        noShowFeeDisputedAt: true,
        noShowFeeStripePaymentIntentId: true,
      },
    })

    if (!booking) {
      return { ok: false as const, code: 'NO_SHOW_FEE_NOT_REFUNDABLE' as const }
    }

    // Already fully refunded — in-app already, or reconciled from a Dashboard
    // refund by GAP B (which flips the status to REFUNDED at full). Nothing left.
    if (booking.noShowFeeStatus === NoShowFeeStatus.REFUNDED) {
      return { ok: false as const, code: 'NO_SHOW_FEE_ALREADY_REFUNDED' as const }
    }

    // Only a CHARGED fee moved money to give back. SKIPPED never charged; a FAILED
    // fee is forgiven via waiveNoShowFee (no money moved); WAIVED is settled. Guard
    // the PI + amount too so we never call Stripe without a charge to reverse.
    if (
      booking.noShowFeeStatus !== NoShowFeeStatus.CHARGED ||
      !booking.noShowFeeStripePaymentIntentId ||
      !booking.noShowFeeAmount
    ) {
      return { ok: false as const, code: 'NO_SHOW_FEE_NOT_REFUNDABLE' as const }
    }

    // Frozen while the fee charge is under (or lost) a Stripe dispute: the
    // chargeback already pulled the fee and reversed the transfer off the pro, so
    // issuing our own refund would double-return the fee. A WON dispute clears
    // noShowFeeDisputedAt (applyStripeNoShowFeeDisputeInTransaction), re-opening
    // refunds; a LOST dispute keeps it frozen forever (the money is already gone).
    // Mirrors refundDiscoveryDeposit's deposit freeze with a distinct log identity.
    if (booking.noShowFeeDisputedAt) {
      return {
        ok: false as const,
        code: 'NO_SHOW_FEE_REFUND_FROZEN_DISPUTED' as const,
        disputed: true as const,
      }
    }

    const feeCents = noShowFeeAmountToCents(booking.noShowFeeAmount)
    const alreadyRefunded = booking.noShowFeeRefundedCents
    const remaining = feeCents - alreadyRefunded

    // Nothing left to give back (a Dashboard partial already brought it whole).
    if (remaining <= 0) {
      return { ok: false as const, code: 'NO_SHOW_FEE_ALREADY_REFUNDED' as const }
    }

    // Full-refund-only: return the entire remaining balance and flip to REFUNDED.
    // The fee is a single destination charge, so the cumulative reaching the charge
    // total IS a full refund — there is no deposit-portion split (unlike the
    // deposit charge, which bundles the platform fee).
    const nextRefunded = alreadyRefunded + remaining

    await tx.booking.update({
      where: { id: args.bookingId },
      data: {
        noShowFeeRefundedCents: nextRefunded,
        noShowFeeStatus: NoShowFeeStatus.REFUNDED,
      },
      select: { id: true } satisfies Prisma.BookingSelect,
    })

    return {
      ok: true as const,
      paymentIntentId: booking.noShowFeeStripePaymentIntentId,
      refundAmountCents: remaining,
      alreadyRefunded,
    }
  })

  if (!claim.ok) {
    if (claim.code === 'NO_SHOW_FEE_REFUND_FROZEN_DISPUTED') {
      // The freeze fired: a refund was requested against a fee whose charge is
      // under (or lost) a Stripe dispute. Benign — the dispute already paged
      // (captureStripeDisputeAlert) — but log it with a distinct identity so the
      // refusal is visible and not mistaken for "nothing to refund".
      console.warn(
        JSON.stringify({
          level: 'warn',
          app: 'tovis',
          namespace: 'payments',
          event: 'no_show_fee_refund_frozen_disputed',
          bookingId: args.bookingId,
        }),
      )
    }
    return { outcome: 'NOT_ATTEMPTED', code: claim.code }
  }

  try {
    const stripe = getStripe()
    const stripeRefund = await stripe.refunds.create(
      {
        payment_intent: claim.paymentIntentId,
        amount: claim.refundAmountCents,
        reverse_transfer: true,
        metadata: {
          bookingId: args.bookingId,
          kind: 'NO_SHOW_FEE_REFUND',
          trigger: BookingRefundTrigger.DISCRETIONARY,
        },
      },
      // Per-refund key (carries the pre-refund cumulative) so a retry of THIS
      // refund stays idempotent; a second refund on a fully-refunded fee is
      // refused at the claim above, so keys never collide across distinct refunds.
      {
        idempotencyKey: `tovis:no-show-fee-refund:${args.bookingId}:${claim.alreadyRefunded}`,
      },
    )

    // Durable SUCCEEDED row on the FEE PI. M3's per-PI reservation math scopes
    // every aggregate by stripePaymentIntentId, so this fee-PI row never shrinks
    // the service or deposit refundable remainders.
    await prisma.bookingRefund.create({
      data: {
        bookingId: args.bookingId,
        amountCents: claim.refundAmountCents,
        currency: 'usd',
        status: BookingRefundStatus.SUCCEEDED,
        trigger: BookingRefundTrigger.DISCRETIONARY,
        reverseTransfer: true,
        applicationFeeRefunded: false,
        stripeRefundId: stripeRefund.id,
        stripePaymentIntentId: claim.paymentIntentId,
        initiatedByUserId: args.actor?.userId ?? null,
        initiatedByRole: args.actor?.role ?? null,
        reason: args.reason ?? null,
      },
    })

    // Refund receipt (M6), best-effort so a receipt failure can never unwind a
    // completed refund. GAP B's exact discriminator carries the post-refund
    // cumulative, so when the fee `charge.refunded` webhook later lands,
    // reconcileNoShowFeeChargeRefundInTransaction sees no cumulative rise and stays
    // silent — the client is notified exactly once. Mirrors refundDiscoveryDeposit.
    const refundedCumulativeCents = claim.alreadyRefunded + claim.refundAmountCents
    await emitRefundReceiptBestEffort({
      bookingId: args.bookingId,
      refundDiscriminator: buildAuxRefundDiscriminator({
        kind: 'no-show-fee',
        paymentIntentId: claim.paymentIntentId,
        cumulativeRefundedCents: refundedCumulativeCents,
      }),
      amountRefundedCents: claim.refundAmountCents,
      logLabel: 'refundNoShowFee',
    })

    return { outcome: 'REFUNDED', refundAmountCents: claim.refundAmountCents }
  } catch (error) {
    const { failureCode, failureMessage } = describeStripeRefundFailure(
      error,
      'No-show fee refund failed.',
    )

    // Release the reservation — restore CHARGED + decrement the cents this call
    // added — and record a durable FAILED row in the SAME transaction: the
    // rollback alone leaves no trace, which would make a failed fee refund
    // invisible in the money trail. Under the lock so a concurrent refund sees a
    // consistent counter. No retry sweep re-drives this: the row is DISCRETIONARY
    // (the sweep only retries AUTO_CANCELLATION) and the fee PI classifies to
    // neither the service nor deposit flavor — a failed discretionary fee refund
    // has a human owner.
    try {
      await prisma.$transaction(async (tx) => {
        await lockBookingForRefund(tx, args.bookingId)
        await tx.booking.update({
          where: { id: args.bookingId },
          data: {
            noShowFeeRefundedCents: { decrement: claim.refundAmountCents },
            noShowFeeStatus: NoShowFeeStatus.CHARGED,
          },
          select: { id: true } satisfies Prisma.BookingSelect,
        })
        await tx.bookingRefund.create({
          data: {
            bookingId: args.bookingId,
            amountCents: claim.refundAmountCents,
            currency: 'usd',
            status: BookingRefundStatus.FAILED,
            trigger: BookingRefundTrigger.DISCRETIONARY,
            reverseTransfer: true,
            applicationFeeRefunded: false,
            initiatedByUserId: args.actor?.userId ?? null,
            initiatedByRole: args.actor?.role ?? null,
            reason: args.reason ?? null,
            stripePaymentIntentId: claim.paymentIntentId,
            failureCode,
            failureMessage: failureMessage.slice(0, 500),
          },
        })
      })
    } catch (rollbackError) {
      // Double fault: the rollback itself failed. noShowFeeRefundedCents is
      // stranded claiming cents the client never received, and no FAILED row
      // exists — a human must reconcile this booking.
      console.error('refundNoShowFee: reservation rollback failed', {
        bookingId: args.bookingId,
        error: safeError(rollbackError),
      })
      Sentry.captureException(rollbackError)
    }

    console.error('refundNoShowFee: Stripe refund failed', {
      bookingId: args.bookingId,
      error: safeError(error),
    })
    Sentry.captureException(error)

    return { outcome: 'FAILED', message: failureMessage }
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
 * Map a Stripe refund object to the `ChargeRefundReconcileInput` refund shape.
 * The single mapper for BOTH the live `charge.refunded` webhook and the hourly
 * reconciliation sweep, so the two paths can never drift. In particular it
 * always carries the `metadata.bookingRefundId` pass-through the N3 recovery
 * depends on — a sweep that dropped it (as this one silently did) could not
 * adopt a reserved-but-unsettled row the way the webhook can.
 */
export function mapStripeRefundToReconcileInput(
  refund: Stripe.Refund,
): ChargeRefundReconcileInput['refunds'][number] {
  const rawBookingRefundId = refund.metadata?.bookingRefundId
  const bookingRefundId =
    typeof rawBookingRefundId === 'string' && rawBookingRefundId.trim()
      ? rawBookingRefundId.trim()
      : null

  return {
    id: refund.id,
    status: refund.status,
    amountCents: typeof refund.amount === 'number' ? refund.amount : 0,
    bookingRefundId,
  }
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
