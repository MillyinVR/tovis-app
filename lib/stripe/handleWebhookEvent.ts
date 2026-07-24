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
  applyStripeNoShowFeeDisputeInTransaction,
  applyStripePaymentFailedInTransaction,
  applyStripePaymentSucceededInTransaction,
  reconcileDepositChargeRefundInTransaction,
  reconcileNoShowFeeChargeRefundInTransaction,
  DISCOVERY_DEPOSIT_CHECKOUT_KIND,
  NO_SHOW_FEE_CHARGE_KIND,
  type StripeDisputeOutcome,
} from '@/lib/booking/writeBoundary'
import {
  mapStripeRefundToReconcileInput,
  reconcileChargeRefundInTransaction,
} from '@/lib/booking/refunds'
import type { LateCaptureRefundFlavor } from '@/lib/booking/cancelRefund'
import { captureStripeDisputeAlert } from '@/lib/observability/bookingEvents'
import { applyStripeSubscriptionInTransaction } from '@/lib/membership/syncSubscription'
import { stripeExpandedId } from '@/lib/stripe/expandable'

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
  /**
   * M9 — present when a card charge applied onto a booking the pro had already
   * closed out by hand (mark-paid cash / waive): the client was over-collected.
   * The caller MUST page a human post-commit
   * (captureManualCloseoutStripeOverCollection); the money is already captured,
   * so a human refunds the card via the existing refund endpoint. Alert-only —
   * no automated refund (Tori, 2026-07-23).
   */
  manualCloseoutOverCollection?: { bookingId: string; flavor: 'SERVICE' }
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

function isDiscoveryDepositMetadata(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  return getMetadataString(metadata, 'kind') === DISCOVERY_DEPOSIT_CHECKOUT_KIND
}

/**
 * A no-show / late-cancel fee PaymentIntent (lib/noShowProtection/charge.ts).
 * Its success/outcome is recorded SYNCHRONOUSLY by the charge orchestrator; the
 * booking's final-bill fields must never be touched by its webhook. Critical:
 * the fee PI carries `metadata.bookingId`, and findBookingForStripeWebhook
 * resolves that hint FIRST — so without this branch a fee `payment_intent.
 * succeeded` would apply the fee amount as the booking's payment (marking a
 * no-show booking PAID/COMPLETED, or auto-refunding a late-cancel fee via the
 * M1 late-capture path on the CANCELLED booking).
 */
function isNoShowFeeMetadata(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  return getMetadataString(metadata, 'kind') === NO_SHOW_FEE_CHARGE_KIND
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
        stripePaymentIntentId: stripeExpandedId(session.payment_intent),
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
    stripePaymentIntentId: stripeExpandedId(session.payment_intent),
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

async function handlePaymentIntentSucceeded(
  tx: Prisma.TransactionClient,
  paymentIntent: Stripe.PaymentIntent,
  stripeEventId: string,
): Promise<StripeWebhookResult> {
  const bookingIdHint = getMetadataString(paymentIntent.metadata, 'bookingId')

  // No-show / late-cancel fee PI: recorded synchronously by the charge path.
  // Its bookingId in metadata would otherwise route this into the final-bill
  // applier and record the fee as the booking's payment — never do that.
  if (isNoShowFeeMetadata(paymentIntent.metadata)) {
    return {
      handled: true,
      message: 'payment_intent.succeeded no-show fee — recorded on charge, no booking payment applied.',
    }
  }

  // Discovery deposit PI: record the deposit, don't touch final-bill fields.
  if (isDiscoveryDepositMetadata(paymentIntent.metadata)) {
    return handleDepositPaid(tx, {
      stripePaymentIntentId: paymentIntent.id,
      chargeId: stripeExpandedId(paymentIntent.latest_charge),
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
    ...(result.capturedAfterManualCloseout
      ? {
          manualCloseoutOverCollection: {
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

  // No-show / late-cancel fee PI: a decline is recorded (FAILED) synchronously
  // by the charge path. Its bookingId hint would otherwise mark the booking's
  // FINAL-BILL payment FAILED — leave the booking's payment state untouched.
  if (isNoShowFeeMetadata(paymentIntent.metadata)) {
    return {
      handled: true,
      message: 'payment_intent.payment_failed no-show fee — recorded on charge, booking payment untouched.',
    }
  }

  // Discovery deposit PI: a declined deposit card is the deposit Checkout's to
  // retry — the deposit stays PENDING (M5's release sweep owns abandonment) and
  // the booking's FINAL-BILL fields must never be touched. Without this branch
  // (M16, plan §21.4 R1) the bookingId hint routed the failure into the
  // final-bill applier, stamping provider/method + `stripePaymentIntentId=<the
  // DEPOSIT PI>` + FAILED and emitting a spurious action-required notification —
  // and the poisoned PI column then routed a later deposit dispute into the
  // SERVICE dispute applier, bypassing M4's depositDisputedAt refund freeze.
  // Mirrors the isDiscoveryDepositMetadata gate on the succeeded sibling above.
  if (isDiscoveryDepositMetadata(paymentIntent.metadata)) {
    return {
      handled: true,
      message:
        'payment_intent.payment_failed discovery deposit — deposit checkout owns retries, booking payment untouched.',
    }
  }

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

  const amountRefundedCents =
    typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0
  const chargeAmountCents = typeof charge.amount === 'number' ? charge.amount : 0

  // Deposit refunds ride a separate PaymentIntent — reconcile those first.
  const depositResult = await reconcileDepositChargeRefundInTransaction(tx, {
    paymentIntentId,
    amountRefundedCents,
    chargeAmountCents,
  })

  if (depositResult.handled) {
    return { handled: true, message: 'charge.refunded reconciled deposit.' }
  }

  // The no-show / late-cancel fee also rides its OWN PaymentIntent (M15 GAP B).
  // A fee-PI refund never matches the final-bill reconcile below (it resolves by
  // stripePaymentIntentId), so try it here before falling through — the three PI
  // kinds are disjoint, so at most one of these branches ever handles a charge.
  const noShowFeeResult = await reconcileNoShowFeeChargeRefundInTransaction(tx, {
    paymentIntentId,
    amountRefundedCents,
    chargeAmountCents,
  })

  if (noShowFeeResult.handled) {
    return { handled: true, message: 'charge.refunded reconciled no-show fee.' }
  }

  // Shared mapper with the hourly reconciliation sweep (lib/booking/refunds) so
  // the two paths can never drift — notably the metadata.bookingRefundId
  // pass-through the N3 reserved-but-unsettled-row recovery depends on.
  const refunds = (charge.refunds?.data ?? []).map(mapStripeRefundToReconcileInput)

  const result = await reconcileChargeRefundInTransaction(tx, {
    paymentIntentId,
    amountRefundedCents,
    chargeAmountCents,
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

  // The no-show / late-cancel fee rides its OWN PI too (M15 GAP B) — its own
  // freeze on noShowFeeDisputedAt, distinct from the service/deposit freezes.
  const noShowFeeResult = await applyStripeNoShowFeeDisputeInTransaction(tx, {
    feePaymentIntentId: paymentIntentId,
    outcome,
  })

  if (noShowFeeResult) {
    if (alerting) {
      captureStripeDisputeAlert({
        bookingId: noShowFeeResult.bookingId,
        paymentIntentId,
        disputeId: dispute.id,
        disputeStatus: dispute.status,
        outcome,
        eventType,
        flavor: 'NO_SHOW_FEE',
      })
    }
    return {
      handled: true,
      message: `${eventType} applied to no-show fee (${outcome}).`,
    }
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
