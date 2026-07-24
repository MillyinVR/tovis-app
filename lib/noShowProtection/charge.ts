// lib/noShowProtection/charge.ts
//
// Orchestrates a no-show / late-cancel fee charge (Phase 2 revenue protection).
// Reads the booking + the pro's fee policy + the client's default saved card,
// computes the fee, and — mirroring the destination charge on client checkout
// (transfer_data.destination) — charges the client's card OFF-SESSION and routes
// the money to the pro's connected account. The Booking write recording the
// outcome goes through the write boundary (recordNoShowFeeCharge), because the
// booking-boundary guard requires all Booking writes to live there.
//
// Inert unless ENABLE_NO_SHOW_PROTECTION is on: the flag check short-circuits
// before any card is touched. Idempotent per booking via a stable Stripe
// idempotency key and a CHARGED short-circuit.

import {
  BookingDepositStatus,
  BookingStatus,
  NoShowFeeReason,
  NoShowFeeStatus,
  NoShowFeeType,
  Prisma,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import {
  computeNoShowFeeAmount,
  isWithinCancelWindow,
  noShowFeeAmountToCents,
} from '@/lib/noShowProtection/fee'
import { parseCancellationPolicySnapshot } from '@/lib/noShowProtection/policyDisclosure'

/**
 * The resolved fee terms used for a charge — either the client's agreed snapshot
 * or the pro's live settings (see assessAndChargeNoShowFee). A superset of
 * NoShowFeePolicy (the fee-math input) plus the window + which events trigger.
 */
type NoShowFeePolicyTerms = {
  feeType: NoShowFeeType
  feeFlatAmount: Prisma.Decimal | null
  feePercent: number | null
  cancelWindowHours: number
  chargeNoShow: boolean
  chargeLateCancel: boolean
}
import {
  recordNoShowDepositKept,
  recordNoShowFeeCharge,
  NO_SHOW_FEE_CHARGE_KIND,
} from '@/lib/booking/writeBoundary'

export type NoShowFeeOutcome =
  // Flag off, policy off/misconfigured, no card, pro not connected, out of
  // window, or already handled — nothing was charged and no state changed.
  | { kind: 'NOT_CHARGEABLE'; reason: string }
  // A charge was attempted; `status` is CHARGED or FAILED. `alreadyCharged` is
  // true when a prior CHARGED result was found (idempotent no-op).
  | {
      kind: 'ATTEMPTED'
      status: NoShowFeeStatus
      amount: string
      stripePaymentIntentId: string | null
      alreadyCharged: boolean
    }
  // The fee was owed but skipped for a recorded reason (no card / pro not ready).
  | { kind: 'SKIPPED'; reason: string; amount: string }

function stripePaymentIntentIdFromError(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const raw = (error as { raw?: unknown }).raw
  if (typeof raw !== 'object' || raw === null) return null
  const pi = (raw as { payment_intent?: unknown }).payment_intent
  if (typeof pi !== 'object' || pi === null) return null
  const id = (pi as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Assess and (if owed) charge the no-show / late-cancel fee for a booking.
 *
 * @param reason NO_SHOW when the pro marked the booking; LATE_CANCEL when a
 *   client cancelled — LATE_CANCEL additionally requires the cancel to fall
 *   inside the pro's window.
 * @param priorStatus the booking's status *before* it was cancelled. Only a
 *   confirmed (ACCEPTED) booking can incur a late-cancel fee — a client
 *   withdrawing an unaccepted request is never billed. Required in practice for
 *   LATE_CANCEL; ignored for NO_SHOW (the transition already enforced ACCEPTED).
 */
export async function assessAndChargeNoShowFee(args: {
  bookingId: string
  reason: NoShowFeeReason
  priorStatus?: BookingStatus
  now?: Date
}): Promise<NoShowFeeOutcome> {
  if (!noShowProtectionEnabled()) {
    return { kind: 'NOT_CHARGEABLE', reason: 'flag_off' }
  }

  const now = args.now ?? new Date()

  const booking = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      scheduledFor: true,
      subtotalSnapshot: true,
      noShowFeeStatus: true,
      depositStatus: true,
      cancellationPolicySnapshot: true,
      client: {
        select: {
          stripeCustomerId: true, // pii-plaintext-read-ok: opaque Stripe billing id
          paymentMethods: {
            where: { isDefault: true },
            select: { stripePaymentMethodId: true },
            take: 1,
          },
        },
      },
      professional: {
        select: {
          noShowSettings: {
            select: {
              enabled: true,
              feeType: true,
              feeFlatAmount: true,
              feePercent: true,
              cancelWindowHours: true,
              chargeNoShow: true,
              chargeLateCancel: true,
            },
          },
          paymentSettings: {
            select: {
              stripeAccountId: true, // pii-plaintext-read-ok: opaque Stripe Connect account id
              acceptStripeCard: true,
              stripeChargesEnabled: true,
            },
          },
        },
      },
    },
  })

  if (!booking) return { kind: 'NOT_CHARGEABLE', reason: 'booking_not_found' }

  // Idempotent: a prior success is never re-charged.
  if (booking.noShowFeeStatus === NoShowFeeStatus.CHARGED) {
    return {
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.CHARGED,
      amount: booking.subtotalSnapshot.toFixed(2),
      stripePaymentIntentId: null,
      alreadyCharged: true,
    }
  }

  // Charge from the policy the client AGREED to at booking (the snapshot), so a
  // pro editing their live settings afterward can never charge more than was
  // disclosed (M15). A snapshot only exists once an interactive client accepted,
  // so its presence means the terms are agreed. Bookings with no snapshot
  // (aftercare-token / pro-created / pre-feature) fall back to the pro's live
  // settings, which still require `enabled`.
  const snapshot = parseCancellationPolicySnapshot(
    booking.cancellationPolicySnapshot,
  )
  const liveSettings = booking.professional.noShowSettings
  const policy: NoShowFeePolicyTerms | null = snapshot
    ? {
        feeType: snapshot.feeType,
        feeFlatAmount:
          snapshot.feeFlatAmount != null
            ? new Prisma.Decimal(snapshot.feeFlatAmount)
            : null,
        feePercent: snapshot.feePercent,
        cancelWindowHours: snapshot.cancelWindowHours,
        chargeNoShow: snapshot.chargeNoShow,
        chargeLateCancel: snapshot.chargeLateCancel,
      }
    : liveSettings?.enabled
      ? {
          feeType: liveSettings.feeType,
          feeFlatAmount: liveSettings.feeFlatAmount,
          feePercent: liveSettings.feePercent,
          cancelWindowHours: liveSettings.cancelWindowHours,
          chargeNoShow: liveSettings.chargeNoShow,
          chargeLateCancel: liveSettings.chargeLateCancel,
        }
      : null

  if (!policy) {
    return { kind: 'NOT_CHARGEABLE', reason: 'protection_off' }
  }

  if (args.reason === NoShowFeeReason.NO_SHOW) {
    if (!policy.chargeNoShow) {
      return { kind: 'NOT_CHARGEABLE', reason: 'no_show_charging_off' }
    }
    // M15 POLICY analog (Tori 2026-07-24): a kept discovery deposit IS the
    // penalty for a no-show, so it SUPPRESSES the separate no-show fee — the
    // same "the deposit is the penalty, don't double-charge" call made for a
    // late-cancel forfeit (cancel route). The no-show transition never touches
    // the deposit, so a PAID status here means the pro is keeping the captured
    // deposit; charging a fee on top would double-penalise the client.
    // (LATE_CANCEL is suppressed upstream in the cancel route via the FORFEITED
    // signal, which correctly still charges when a wide-window deposit is
    // REFUNDED or its refund FAILED — so this gate is NO_SHOW-only.)
    if (booking.depositStatus === BookingDepositStatus.PAID) {
      // Disclose the kept deposit to the client — it's their only no-show money
      // notice, since no fee is charged. Best-effort: a notification failure must
      // never change the suppression outcome (the no-show already committed).
      await recordNoShowDepositKept({
        bookingId: booking.id,
        professionalId: booking.professionalId,
      }).catch((error: unknown) => {
        console.error('assessAndChargeNoShowFee: deposit-kept notice failed', {
          bookingId: booking.id,
          message: error instanceof Error ? error.message : String(error),
        })
      })
      return { kind: 'NOT_CHARGEABLE', reason: 'deposit_kept_suppresses_fee' }
    }
  }

  if (args.reason === NoShowFeeReason.LATE_CANCEL) {
    if (!policy.chargeLateCancel) {
      return { kind: 'NOT_CHARGEABLE', reason: 'late_cancel_charging_off' }
    }
    // Only a confirmed booking carries a late-cancel fee — a client withdrawing
    // an unaccepted (PENDING) request is never billed.
    if (args.priorStatus && args.priorStatus !== BookingStatus.ACCEPTED) {
      return { kind: 'NOT_CHARGEABLE', reason: 'not_confirmed' }
    }
    if (
      !isWithinCancelWindow({
        scheduledFor: booking.scheduledFor,
        windowHours: policy.cancelWindowHours,
        now,
      })
    ) {
      return { kind: 'NOT_CHARGEABLE', reason: 'outside_cancel_window' }
    }
  }

  const feeAmount = computeNoShowFeeAmount(policy, booking.subtotalSnapshot)
  if (!feeAmount) return { kind: 'NOT_CHARGEABLE', reason: 'no_fee_owed' }

  const amountStr = feeAmount.toFixed(2)

  // Client must have a Stripe customer + a default saved card.
  const customerId = booking.client.stripeCustomerId // pii-plaintext-read-ok: opaque Stripe billing id
  const defaultCard = booking.client.paymentMethods[0]
  if (!customerId || !defaultCard) {
    await recordNoShowFeeCharge({
      bookingId: booking.id,
      professionalId: booking.professionalId,
      status: NoShowFeeStatus.SKIPPED,
      reason: args.reason,
      amount: feeAmount,
      stripePaymentIntentId: null,
      now,
    })
    return { kind: 'SKIPPED', reason: 'no_card_on_file', amount: amountStr }
  }

  // Pro must be able to receive a destination charge.
  const pay = booking.professional.paymentSettings
  const connectedAccountId = pay?.stripeAccountId ?? null // pii-plaintext-read-ok: opaque Stripe Connect account id
  if (
    !connectedAccountId ||
    !pay?.acceptStripeCard ||
    !pay?.stripeChargesEnabled
  ) {
    await recordNoShowFeeCharge({
      bookingId: booking.id,
      professionalId: booking.professionalId,
      status: NoShowFeeStatus.SKIPPED,
      reason: args.reason,
      amount: feeAmount,
      stripePaymentIntentId: null,
      now,
    })
    return { kind: 'SKIPPED', reason: 'pro_not_connected', amount: amountStr }
  }

  const stripe = getStripe()
  const amountCents = noShowFeeAmountToCents(feeAmount)

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        customer: customerId,
        payment_method: defaultCard.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        transfer_data: { destination: connectedAccountId },
        metadata: {
          bookingId: booking.id,
          clientId: booking.clientId,
          professionalId: booking.professionalId,
          // The webhook branches on this kind so the fee PI's success/failure
          // event is not misrouted into the final-bill applier (it carries this
          // booking's bookingId, which the webhook's hint-resolver matches first).
          kind: NO_SHOW_FEE_CHARGE_KIND,
          reason: args.reason,
        },
      },
      { idempotencyKey: `tovis:no-show-fee:${booking.id}` },
    )

    const succeeded = intent.status === 'succeeded'
    const status = succeeded ? NoShowFeeStatus.CHARGED : NoShowFeeStatus.FAILED

    await recordNoShowFeeCharge({
      bookingId: booking.id,
      professionalId: booking.professionalId,
      status,
      reason: args.reason,
      amount: feeAmount,
      stripePaymentIntentId: intent.id,
      now,
    })

    return {
      kind: 'ATTEMPTED',
      status,
      amount: amountStr,
      stripePaymentIntentId: intent.id,
      alreadyCharged: false,
    }
  } catch (error: unknown) {
    // Off-session declines (card error / authentication_required) land here.
    const stripePaymentIntentId = stripePaymentIntentIdFromError(error)
    console.error('assessAndChargeNoShowFee: off-session charge failed', {
      bookingId: booking.id,
      message: error instanceof Error ? error.message : String(error),
    })

    await recordNoShowFeeCharge({
      bookingId: booking.id,
      professionalId: booking.professionalId,
      status: NoShowFeeStatus.FAILED,
      reason: args.reason,
      amount: feeAmount,
      stripePaymentIntentId,
      now,
    })

    return {
      kind: 'ATTEMPTED',
      status: NoShowFeeStatus.FAILED,
      amount: amountStr,
      stripePaymentIntentId,
      alreadyCharged: false,
    }
  }
}
