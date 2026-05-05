import type Stripe from 'stripe'
import {
  BookingCheckoutStatus,
  PaymentMethod,
  PaymentProvider,
  Prisma,
  StripeAccountStatus,
  StripeCheckoutSessionStatus,
  StripePaymentStatus,
} from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { getStripe, getStripeWebhookSecret } from '@/lib/stripe/server'

export const dynamic = 'force-dynamic'

type StripeWebhookResult = {
  handled: boolean
  message: string
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
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

function normalizeCurrency(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized ? normalized.slice(0, 3) : null
}

async function markEventProcessed(args: {
  stripeEventId: string
  message: string
}): Promise<void> {
  await prisma.stripeWebhookEvent.update({
    where: { stripeEventId: args.stripeEventId },
    data: {
      processedAt: new Date(),
      failedAt: null,
      lastError: null,
    },
  })
}

async function markEventFailed(args: {
  stripeEventId: string
  error: unknown
}): Promise<void> {
  await prisma.stripeWebhookEvent.update({
    where: { stripeEventId: args.stripeEventId },
    data: {
      failedAt: new Date(),
      lastError: args.error instanceof Error ? args.error.message : String(args.error),
    },
  })
}

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<StripeWebhookResult> {
  const bookingId =
    getMetadataString(session.metadata, 'bookingId') ??
    (typeof session.client_reference_id === 'string'
      ? session.client_reference_id
      : null)

  if (!bookingId) {
    return {
      handled: false,
      message: 'checkout.session.completed missing booking metadata.',
    }
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      paymentProvider: PaymentProvider.STRIPE,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      stripeCheckoutSessionStatus: StripeCheckoutSessionStatus.COMPLETE,
      stripeAmountSubtotal:
        typeof session.amount_subtotal === 'number'
          ? session.amount_subtotal
          : undefined,
      stripeAmountTotal:
        typeof session.amount_total === 'number' ? session.amount_total : undefined,
      stripeCurrency: normalizeCurrency(session.currency) ?? undefined,
    },
  })

  return {
    handled: true,
    message: 'checkout.session.completed synced.',
  }
}

async function handleCheckoutSessionExpired(
  session: Stripe.Checkout.Session,
): Promise<StripeWebhookResult> {
  const bookingId =
    getMetadataString(session.metadata, 'bookingId') ??
    (typeof session.client_reference_id === 'string'
      ? session.client_reference_id
      : null)

  if (!bookingId) {
    return {
      handled: false,
      message: 'checkout.session.expired missing booking metadata.',
    }
  }

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      stripeCheckoutSessionId: session.id,
      stripeCheckoutSessionStatus: StripeCheckoutSessionStatus.EXPIRED,
    },
  })

  return {
    handled: true,
    message: 'checkout.session.expired synced.',
  }
}

async function findBookingForPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
): Promise<{
  id: string
  professionalId: string
  checkoutStatus: BookingCheckoutStatus
} | null> {
  const bookingId = getMetadataString(paymentIntent.metadata, 'bookingId')

  if (bookingId) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        checkoutStatus: true,
      },
    })
  }

  return prisma.booking.findFirst({
    where: { stripePaymentIntentId: paymentIntent.id },
    select: {
      id: true,
      professionalId: true,
      checkoutStatus: true,
    },
  })
}

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  stripeEventId: string,
): Promise<StripeWebhookResult> {
  const booking = await findBookingForPaymentIntent(paymentIntent)

  if (!booking) {
    return {
      handled: false,
      message: 'payment_intent.succeeded booking not found.',
    }
  }

  const now = new Date()
  const currency = normalizeCurrency(paymentIntent.currency)

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        paymentProvider: PaymentProvider.STRIPE,
        selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
        checkoutStatus: BookingCheckoutStatus.PAID,
        paymentAuthorizedAt: now,
        paymentCollectedAt: now,
        stripePaymentIntentId: paymentIntent.id,
        stripePaymentStatus: StripePaymentStatus.SUCCEEDED,
        stripeAmountTotal:
          typeof paymentIntent.amount_received === 'number'
            ? paymentIntent.amount_received
            : paymentIntent.amount,
        stripeCurrency: currency ?? undefined,
        stripePaidAt: now,
        stripeLastEventId: stripeEventId,
      },
    })

    await tx.bookingCloseoutAuditLog.create({
      data: {
        bookingId: booking.id,
        professionalId: booking.professionalId,
        actorUserId: null,
        action: 'PAYMENT_COLLECTED',
        route: 'POST /api/webhooks/stripe',
        requestId: stripeEventId,
        idempotencyKey: stripeEventId,
        oldValue: {
          checkoutStatus: booking.checkoutStatus,
        },
        newValue: {
          checkoutStatus: BookingCheckoutStatus.PAID,
          paymentProvider: PaymentProvider.STRIPE,
          stripePaymentIntentId: paymentIntent.id,
        },
        metadata: {
          source: 'stripe_webhook',
          stripeEventId,
          stripePaymentIntentId: paymentIntent.id,
          amountReceived: paymentIntent.amount_received,
          amount: paymentIntent.amount,
          currency,
        },
      },
    })
  })

  return {
    handled: true,
    message: 'payment_intent.succeeded marked booking paid.',
  }
}

async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
  stripeEventId: string,
): Promise<StripeWebhookResult> {
  const booking = await findBookingForPaymentIntent(paymentIntent)

  if (!booking) {
    return {
      handled: false,
      message: 'payment_intent.payment_failed booking not found.',
    }
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      paymentProvider: PaymentProvider.STRIPE,
      selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
      stripePaymentIntentId: paymentIntent.id,
      stripePaymentStatus: StripePaymentStatus.FAILED,
      stripeLastEventId: stripeEventId,
    },
  })

  return {
    handled: true,
    message: 'payment_intent.payment_failed synced.',
  }
}

async function handleAccountUpdated(
  account: Stripe.Account,
): Promise<StripeWebhookResult> {
  const settings = await prisma.professionalPaymentSettings.findUnique({
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

  await prisma.professionalPaymentSettings.update({
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

async function handleStripeEvent(event: Stripe.Event): Promise<StripeWebhookResult> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutSessionCompleted(
        event.data.object as Stripe.Checkout.Session,
      )

    case 'checkout.session.expired':
      return handleCheckoutSessionExpired(
        event.data.object as Stripe.Checkout.Session,
      )

    case 'payment_intent.succeeded':
      return handlePaymentIntentSucceeded(
        event.data.object as Stripe.PaymentIntent,
        event.id,
      )

    case 'payment_intent.payment_failed':
      return handlePaymentIntentFailed(
        event.data.object as Stripe.PaymentIntent,
        event.id,
      )

    case 'account.updated':
      return handleAccountUpdated(event.data.object as Stripe.Account)

    default:
      return {
        handled: false,
        message: `Unhandled Stripe event type: ${event.type}`,
      }
  }
}

export async function POST(req: Request) {
  const stripeSignature = req.headers.get('stripe-signature')

  if (!stripeSignature) {
    return jsonFail(400, 'Missing Stripe signature.', {
      code: 'STRIPE_SIGNATURE_REQUIRED',
    })
  }

  let event: Stripe.Event

  try {
    const rawBody = await req.text()

    event = getStripe().webhooks.constructEvent(
      rawBody,
      stripeSignature,
      getStripeWebhookSecret(),
    )
  } catch (error: unknown) {
    console.error('POST /api/webhooks/stripe signature verification failed', error)

    return jsonFail(400, 'Invalid Stripe webhook signature.', {
      code: 'STRIPE_SIGNATURE_INVALID',
    })
  }

  try {
    const createdEvent = await prisma.stripeWebhookEvent
      .create({
        data: {
          stripeEventId: event.id,
          eventType: event.type,
          livemode: Boolean(event.livemode),
          payload: toInputJsonValue(event),
        },
        select: {
          id: true,
          processedAt: true,
        },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return prisma.stripeWebhookEvent.findUnique({
            where: { stripeEventId: event.id },
            select: {
              id: true,
              processedAt: true,
            },
          })
        }

        throw error
      })

    if (createdEvent?.processedAt) {
      return jsonOk(
        {
          ok: true,
          duplicate: true,
          stripeEventId: event.id,
          eventType: event.type,
        },
        200,
      )
    }

    const result = await handleStripeEvent(event)

    await markEventProcessed({
      stripeEventId: event.id,
      message: result.message,
    })

    return jsonOk(
      {
        ok: true,
        stripeEventId: event.id,
        eventType: event.type,
        handled: result.handled,
        message: result.message,
      },
      200,
    )
  } catch (error: unknown) {
    console.error('POST /api/webhooks/stripe processing error', error)

    await markEventFailed({
      stripeEventId: event.id,
      error,
    }).catch((markError) => {
      console.error('POST /api/webhooks/stripe failed to mark event failed', {
        stripeEventId: event.id,
        markError,
      })
    })

    return jsonFail(500, 'Failed to process Stripe webhook.', {
      code: 'STRIPE_WEBHOOK_PROCESSING_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}