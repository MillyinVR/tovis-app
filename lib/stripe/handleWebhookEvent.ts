// lib/stripe/handleWebhookEvent.ts
//
// Pure Stripe webhook event dispatch: given a verified Stripe.Event and a
// transaction client, mutate our booking/payment/subscription state. Lifted out
// of the webhook HTTP route so it can be re-driven verbatim by the
// stripe-webhook-requeue cron for events whose live delivery failed (the route
// persists the full event payload on failure; the requeue job replays it
// through this exact path). The HTTP route owns signature verification,
// event persistence, and the response; this module owns the state transitions.

import type Stripe from 'stripe'
import {
  Prisma,
  StripeAccountStatus,
  StripeCheckoutSessionStatus,
} from '@prisma/client'

import {
  applyStripeCheckoutSessionStatusInTransaction,
  applyStripeDepositDisputeInTransaction,
  applyStripeDepositSucceededInTransaction,
  applyStripeDisputeInTransaction,
  applyStripePaymentFailedInTransaction,
  applyStripePaymentSucceededInTransaction,
  reconcileDepositChargeRefundInTransaction,
  DISCOVERY_DEPOSIT_CHECKOUT_KIND,
  type StripeDisputeOutcome,
} from '@/lib/booking/writeBoundary'
import { reconcileChargeRefundInTransaction } from '@/lib/booking/refunds'
import type { LateCaptureRefundFlavor } from '@/lib/booking/cancelRefund'
import { captureStripeDisputeAlert } from '@/lib/observability/bookingEvents'
import { applyStripeSubscriptionInTransaction } from '@/lib/membership/syncSubscription'

export type StripeWebhookResult = {
  handled: boolean
  message: string
  /**
   * Present when a payment success applied onto an already-CANCELLED booking.
   * The caller MUST run applyLateCaptureCancelRefund with this after its
   * transaction commits — the refund policy involves Stripe I/O, which cannot
   * live inside the webhook transaction. See cancelRefund.ts.
   */
  lateCaptureRefund?: { bookingId: string; flavor: LateCaptureRefundFlavor }
}

function jsonArrayFromStrings(values: string[]): Prisma.InputJsonValue {
  return values
}

function stripeAccountStatusFromAccount(args: {
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  disabledReason: string | null
  currentlyDueCount: number
}): StripeAccountStatus {
  if (args.chargesEnabled && args.payoutsEnabled) {
    return StripeAccountStatus.ENABLED
  }

  if (args.disabledReason || args.currentlyDueCount > 0) {
    return StripeAccountStatus.RESTRICTED
  }

  if (args.detailsSubmitted) {
    return StripeAccountStatus.DISABLED
  }

  return StripeAccountStatus.ONBOARDING_STARTED
}

function getMetadataString(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getSessionPaymentIntentId(
  session: Stripe.Checkout.Session,
): string | null {
  if (typeof session.payment_intent === 'string') return session.payment_intent
  if (
    session.payment_intent &&
    typeof session.payment_intent === 'object' &&
    typeof session.payment_intent.id === 'string'
  ) {
    return session.payment_intent.id
  }
  return null
}

function isDiscoveryDepositMetadata(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  return getMetadataString(metadata, 'kind') === DISCOVERY_DEPOSIT_CHECKOUT_KIND
}

async function handleDepositPaid(
  tx: Prisma.TransactionClient,
  args: {
    stripePaymentIntentId: string | null
    chargeId: string | null
    bookingIdHint: string | null
    eventLabel: string
  },
): Promise<StripeWebhookResult> {
  if (!args.stripePaymentIntentId) {
    return { handled: false, message: `${args.eventLabel} deposit missing payment_intent.` }
  }

  const result = await applyStripeDepositSucceededInTransaction(tx, {
    stripePaymentIntentId: args.stripePaymentIntentId,
    chargeId: args.chargeId,
    bookingIdHint: args.bookingIdHint,
  })

  if (!result.handled) {
    return { handled: false, message: `${args.eventLabel} deposit booking not found.` }
  }

  return {
    handled: true,
    message: result.alreadyPaid
      ? `${args.eventLabel} deposit already recorded.`
      : `${args.eventLabel} deposit marked paid.`,
    ...(result.capturedOnCancelledBooking && result.bookingId
      ? {
          lateCaptureRefund: {
            bookingId: result.bookingId,
            flavor: 'DEPOSIT' as const,
          },
        }
      : {}),
  }
}

async function handleCheckoutSession(
  tx: Prisma.TransactionClient,
  session: Stripe.Checkout.Session,
  status: StripeCheckoutSessionStatus,
  eventLabel: string,
): Promise<StripeWebhookResult>{
  const bookingIdHint =
    getMetadataString(session.metadata, 'bookingId') ??
    (typeof session.client_reference_id === 'string'
      ? session.client_reference_id.trim()
      : null)

  // Discovery deposit checkout: a separate up-front charge that carries the
  // platform fee. Route on the session's KIND, not its status — a deposit
  // session must never fall through to the final-bill field writer below,
  // whatever its outcome (an expired deposit session used to stamp the deposit's
  // session id / PI / amounts plus paymentProvider=STRIPE into the final-bill
  // fields of a booking that never chose card).
  if (isDiscoveryDepositMetadata(session.metadata)) {
    if (status === StripeCheckoutSessionStatus.COMPLETE) {
      return handleDepositPaid(tx, {
        stripePaymentIntentId: getSessionPaymentIntentId(session),
        chargeId: null,
        bookingIdHint,
        eventLabel,
      })
    }

    // Expired (abandoned) deposit checkout: deliberately write nothing. The
    // deposit stays PENDING so the client can re-open a fresh checkout; what
    // should happen to the booking itself (deadline, auto-cancel, pro-facing
    // surface) is a policy decision that does not belong in this handler.
    return {
      handled: true,
      message: `${eventLabel} deposit session ignored — deposit checkout expiry does not modify the booking.`,
    }
  }

  const stripeCheckoutSessionId = session.id
  if (!stripeCheckoutSessionId) {
    return {
      handled: false,
      message: `${eventLabel} missing session id.`,
    }
  }

  const result = await applyStripeCheckoutSessionStatusInTransaction(tx, {
    bookingIdHint,
    stripeCheckoutSessionId,
    stripePaymentIntentId: getSessionPaymentIntentId(session),
    stripeAmountSubtotal:
      typeof session.amount_subtotal === 'number'
        ? session.amount_subtotal
        : null,
    stripeAmountTotal:
      typeof session.amount_total === 'number' ? session.amount_total : null,
    stripeCurrency: typeof session.currency === 'string' ? session.currency : null,
    status,
  })

  if (!result) {
    return {
      handled: false,
      message: `${eventLabel} booking not found.`,
    }
  }

  return {
    handled: true,
    message: `${eventLabel} synced.`,
  }
}

function getPaymentIntentLatestChargeId(
  paymentIntent: Stripe.PaymentIntent,
): string | null {
  const latestCharge = paymentIntent.latest_charge
  if (typeof latestCharge === 'string') return latestCharge
  if (latestCharge && typeof latestCharge === 'object' && typeof latestCharge.id === 'string') {
    return latestCharge.id
  }
  return null
}

async function handlePaymentIntentSucceeded(
  tx: Prisma.TransactionClient,
  paymentIntent: Stripe.PaymentIntent,
  stripeEventId: string,
): Promise<StripeWebhookResult> {
  const bookingIdHint = getMetadataString(paymentIntent.metadata, 'bookingId')

  // Discovery deposit PI: record the deposit, don't touch final-bill fields.
  if (isDiscoveryDepositMetadata(paymentIntent.metadata)) {
    return handleDepositPaid(tx, {
      stripePaymentIntentId: paymentIntent.id,
      chargeId: getPaymentIntentLatestChargeId(paymentIntent),
      bookingIdHint,
      eventLabel: 'payment_intent.succeeded',
    })
  }

  const result = await applyStripePaymentSucceededInTransaction(tx, {
    bookingIdHint,
    stripePaymentIntentId: paymentIntent.id,
    stripeEventId,
    amountReceivedCents:
      typeof paymentIntent.amount_received === 'number'
        ? paymentIntent.amount_received
        : typeof paymentIntent.amount === 'number'
          ? paymentIntent.amount
          : null,
    currency:
      typeof paymentIntent.currency === 'string' ? paymentIntent.currency : null,
  })

  if (!result) {
    return {
      handled: false,
      message: 'payment_intent.succeeded booking not found.',
    }
  }

  return {
    handled: true,
    message: result.bookingCompleted
      ? 'payment_intent.succeeded marked booking paid and completed.'
      : 'payment_intent.succeeded marked booking paid.',
    ...(result.capturedOnCancelledBooking
      ? {
          lateCaptureRefund: {
            bookingId: result.bookingId,
            flavor: 'SERVICE' as const,
          },
        }
      : {}),
  }
}

async function handlePaymentIntentFailed(
  tx: Prisma.TransactionClient,
  paymentIntent: Stripe.PaymentIntent,
  stripeEventId: string,
): Promise<StripeWebhookResult>{
  const bookingIdHint = getMetadataString(paymentIntent.metadata, 'bookingId')

    const result = await applyStripePaymentFailedInTransaction(tx, {
      bookingIdHint,
      stripePaymentIntentId: paymentIntent.id,
      stripeEventId,
    })

  if (!result) {
    return {
      handled: false,
      message: 'payment_intent.payment_failed booking not found.',
    }
  }

  return {
    handled: true,
    message: 'payment_intent.payment_failed synced.',
  }
}

function getChargePaymentIntentId(charge: Stripe.Charge): string | null {
  if (typeof charge.payment_intent === 'string') return charge.payment_intent
  if (
    charge.payment_intent &&
    typeof charge.payment_intent === 'object' &&
    typeof charge.payment_intent.id === 'string'
  ) {
    return charge.payment_intent.id
  }
  return null
}

async function handleChargeRefunded(
  tx: Prisma.TransactionClient,
  charge: Stripe.Charge,
): Promise<StripeWebhookResult> {
  const paymentIntentId = getChargePaymentIntentId(charge)

  if (!paymentIntentId) {
    return {
      handled: false,
      message: 'charge.refunded missing payment_intent.',
    }
  }

  // Deposit refunds ride a separate PaymentIntent — reconcile those first.
  const depositResult = await reconcileDepositChargeRefundInTransaction(tx, {
    paymentIntentId,
    amountRefundedCents:
      typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0,
    chargeAmountCents: typeof charge.amount === 'number' ? charge.amount : 0,
  })

  if (depositResult.handled) {
    return { handled: true, message: 'charge.refunded reconciled deposit.' }
  }

  const refunds = (charge.refunds?.data ?? []).map((refund) => ({
    id: refund.id,
    status: refund.status,
    amountCents: typeof refund.amount === 'number' ? refund.amount : 0,
    // We stamp the reserved BookingRefund id into the refund metadata at
    // creation; reconcile uses it to recover a row that was reserved but never
    // settled (N3). Absent for Dashboard/external refunds.
    bookingRefundId: getMetadataString(refund.metadata, 'bookingRefundId'),
  }))

  const result = await reconcileChargeRefundInTransaction(tx, {
    paymentIntentId,
    amountRefundedCents:
      typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0,
    chargeAmountCents: typeof charge.amount === 'number' ? charge.amount : 0,
    refunds,
  })

  if (!result.handled) {
    return {
      handled: false,
      message: 'charge.refunded booking not found.',
    }
  }

  return {
    handled: true,
    message: 'charge.refunded reconciled.',
  }
}

function getDisputePaymentIntentId(dispute: Stripe.Dispute): string | null {
  if (typeof dispute.payment_intent === 'string') return dispute.payment_intent
  if (
    dispute.payment_intent &&
    typeof dispute.payment_intent === 'object' &&
    typeof dispute.payment_intent.id === 'string'
  ) {
    return dispute.payment_intent.id
  }
  return null
}

export function resolveDisputeOutcome(
  eventType: string,
  dispute: Stripe.Dispute,
): StripeDisputeOutcome {
  if (eventType === 'charge.dispute.closed') {
    // On close the status is the terminal verdict. Only an actual `lost` keeps
    // funds gone; `won` and the early-fraud `warning_closed` mean no loss, so we
    // restore the payment rather than leave it frozen forever.
    return dispute.status === 'lost' ? 'LOST' : 'WON'
  }
  // created / updated / funds_withdrawn — the dispute is active.
  return 'OPEN'
}

export async function handleChargeDispute(
  tx: Prisma.TransactionClient,
  dispute: Stripe.Dispute,
  eventType: string,
  stripeEventId: string,
): Promise<StripeWebhookResult> {
  const paymentIntentId = getDisputePaymentIntentId(dispute)

  if (!paymentIntentId) {
    return { handled: false, message: `${eventType} missing payment_intent.` }
  }

  const outcome = resolveDisputeOutcome(eventType, dispute)

  // Alert on an active or lost dispute (money at risk). A won dispute is good
  // news (payment restored) and needs no page.
  const alerting = outcome !== 'WON'

  // A dispute event carries no bookingId hint and one PI, but a booking has TWO
  // charges: the final-bill PI and the discovery-deposit PI. Try the final bill
  // first (the common case), then the deposit — each has its own freeze.
  const serviceResult = await applyStripeDisputeInTransaction(tx, {
    stripePaymentIntentId: paymentIntentId,
    stripeEventId,
    outcome,
  })

  if (serviceResult) {
    if (alerting) {
      captureStripeDisputeAlert({
        bookingId: serviceResult.bookingId,
        paymentIntentId,
        disputeId: dispute.id,
        disputeStatus: dispute.status,
        outcome,
        eventType,
        flavor: 'SERVICE',
      })
    }
    return { handled: true, message: `${eventType} applied (${outcome}).` }
  }

  const depositResult = await applyStripeDepositDisputeInTransaction(tx, {
    depositPaymentIntentId: paymentIntentId,
    outcome,
  })

  if (depositResult) {
    if (alerting) {
      captureStripeDisputeAlert({
        bookingId: depositResult.bookingId,
        paymentIntentId,
        disputeId: dispute.id,
        disputeStatus: dispute.status,
        outcome,
        eventType,
        flavor: 'DEPOSIT',
      })
    }
    return { handled: true, message: `${eventType} applied to deposit (${outcome}).` }
  }

  return { handled: false, message: `${eventType} booking not found.` }
}

async function handleSubscriptionEvent(
  tx: Prisma.TransactionClient,
  subscription: Stripe.Subscription,
  eventLabel: string,
  opts?: { deleted?: boolean },
): Promise<StripeWebhookResult> {
  const result = await applyStripeSubscriptionInTransaction(tx, subscription, opts)

  if (!result.handled) {
    return { handled: false, message: `${eventLabel} subscription not matched.` }
  }

  return { handled: true, message: `${eventLabel} synced.` }
}

async function handleAccountUpdated(
  tx: Prisma.TransactionClient,
  account: Stripe.Account,
): Promise<StripeWebhookResult>{
  const settings = await tx.professionalPaymentSettings.findUnique({
    where: { stripeAccountId: account.id },
    select: {
      professionalId: true,
      stripeOnboardingCompletedAt: true,
    },
  })

  if (!settings) {
    return {
      handled: false,
      message: 'account.updated payment settings not found.',
    }
  }

  const chargesEnabled = Boolean(account.charges_enabled)
  const payoutsEnabled = Boolean(account.payouts_enabled)
  const detailsSubmitted = Boolean(account.details_submitted)
  const currentlyDue = account.requirements?.currently_due ?? []
  const eventuallyDue = account.requirements?.eventually_due ?? []
  const disabledReason = account.requirements?.disabled_reason ?? null

  const stripeAccountStatus = stripeAccountStatusFromAccount({
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    disabledReason,
    currentlyDueCount: currentlyDue.length,
  })

  await tx.professionalPaymentSettings.update({
    where: { professionalId: settings.professionalId },
    data: {
      stripeAccountStatus,
      stripeChargesEnabled: chargesEnabled,
      stripePayoutsEnabled: payoutsEnabled,
      stripeDetailsSubmitted: detailsSubmitted,
      stripeRequirementsCurrentlyDue: jsonArrayFromStrings(currentlyDue),
      stripeRequirementsEventuallyDue: jsonArrayFromStrings(eventuallyDue),
      stripeOnboardingCompletedAt:
        stripeAccountStatus === StripeAccountStatus.ENABLED
          ? settings.stripeOnboardingCompletedAt ?? new Date()
          : settings.stripeOnboardingCompletedAt,
      stripeAccountUpdatedAt: new Date(),
      acceptStripeCard: chargesEnabled && payoutsEnabled,
    },
  })

  return {
    handled: true,
    message: 'account.updated synced.',
  }
}

export async function handleStripeEvent(
  tx: Prisma.TransactionClient,
  event: Stripe.Event,
): Promise<StripeWebhookResult> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutSession(
        tx,
        event.data.object as Stripe.Checkout.Session,
        StripeCheckoutSessionStatus.COMPLETE,
        'checkout.session.completed',
      )

    case 'checkout.session.expired':
      return handleCheckoutSession(
        tx,
        event.data.object as Stripe.Checkout.Session,
        StripeCheckoutSessionStatus.EXPIRED,
        'checkout.session.expired',
      )

    case 'payment_intent.succeeded':
      return handlePaymentIntentSucceeded(
        tx,
        event.data.object as Stripe.PaymentIntent,
        event.id,
      )

    case 'payment_intent.payment_failed':
      return handlePaymentIntentFailed(
        tx,
        event.data.object as Stripe.PaymentIntent,
        event.id,
      )

    case 'charge.refunded':
      return handleChargeRefunded(tx, event.data.object as Stripe.Charge)

    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.funds_withdrawn':
    case 'charge.dispute.closed':
      return handleChargeDispute(
        tx,
        event.data.object as Stripe.Dispute,
        event.type,
        event.id,
      )

    case 'account.updated':
      return handleAccountUpdated(tx, event.data.object as Stripe.Account)

    case 'customer.subscription.created':
      return handleSubscriptionEvent(
        tx,
        event.data.object as Stripe.Subscription,
        'customer.subscription.created',
      )

    case 'customer.subscription.updated':
      return handleSubscriptionEvent(
        tx,
        event.data.object as Stripe.Subscription,
        'customer.subscription.updated',
      )

    case 'customer.subscription.deleted':
      return handleSubscriptionEvent(
        tx,
        event.data.object as Stripe.Subscription,
        'customer.subscription.deleted',
        { deleted: true },
      )

    default:
      return {
        handled: false,
        message: `Unhandled Stripe event type: ${event.type}`,
      }
  }
}
