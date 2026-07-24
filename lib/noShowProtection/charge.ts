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

import { BookingStatus, NoShowFeeReason, NoShowFeeStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import {
  computeNoShowFeeAmount,
  isWithinCancelWindow,
  noShowFeeAmountToCents,
} from '@/lib/noShowProtection/fee'
import {
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

  const settings = booking.professional.noShowSettings
  if (!settings || !settings.enabled) {
    return { kind: 'NOT_CHARGEABLE', reason: 'protection_off' }
  }

  if (args.reason === NoShowFeeReason.NO_SHOW && !settings.chargeNoShow) {
    return { kind: 'NOT_CHARGEABLE', reason: 'no_show_charging_off' }
  }

  if (args.reason === NoShowFeeReason.LATE_CANCEL) {
    if (!settings.chargeLateCancel) {
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
        windowHours: settings.cancelWindowHours,
        now,
      })
    ) {
      return { kind: 'NOT_CHARGEABLE', reason: 'outside_cancel_window' }
    }
  }

  const feeAmount = computeNoShowFeeAmount(settings, booking.subtotalSnapshot)
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
