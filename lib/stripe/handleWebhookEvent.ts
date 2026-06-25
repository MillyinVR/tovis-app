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
  applyStripeDepositSucceededInTransaction,
  applyStripePaymentFailedInTransaction,
  applyStripePaymentSucceededInTransaction,
  reconcileDepositChargeRefundInTransaction,
  DISCOVERY_DEPOSIT_CHECKOUT_KIND,
} from '@/lib/booking/writeBoundary'
import { reconcileChargeRefundInTransaction } from '@/lib/booking/refunds'
import { applyStripeSubscriptionInTransaction } from '@/lib/membership/syncSubscription'

export type StripeWebhookResult = {
  handled: boolean
  message: string
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

  // Discovery deposit checkout: a separate up-front charge that carries the platform
  // fee — never touch the final-bill payment fields for it.
  if (
    status === StripeCheckoutSessionStatus.COMPLETE &&
    isDiscoveryDepositMetadata(session.metadata)
  ) {
    return handleDepositPaid(tx, {
      stripePaymentIntentId: getSessionPaymentIntentId(session),
      chargeId: null,
      bookingIdHint,
      eventLabel,
    })
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
