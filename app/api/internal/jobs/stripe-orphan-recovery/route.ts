// app/api/internal/jobs/stripe-orphan-recovery/route.ts
//
// Cron: */10 * * * * (every 10 minutes)
//
// Recovers bookings where Stripe collected payment but the
// payment_intent.succeeded webhook never reached the write boundary
// because of a lost webhook, transient outage, deploy hiccup, or other gremlin nonsense.
//
// For each candidate booking:
// - has a Stripe checkout session
// - uses Stripe as the payment provider
// - has not collected payment locally
// - has not already recorded a succeeded Stripe payment
// - is not COMPLETED or CANCELLED
// - was created at least MIN_AGE_MINUTES ago, so normal webhook flow gets first shot
// - was created no more than MAX_AGE_HOURS ago, so the sweep stays bounded
//
// We ask Stripe whether the Checkout Session is actually paid.
// If yes, we replay applyStripePaymentSucceeded with a synthetic event id.
// The write boundary owns the actual mutation and idempotency rules.
//
// Failures are logged per booking; one bad Stripe session never blocks the rest
// of the sweep.

import type Stripe from 'stripe'
import {
  BookingStatus,
  PaymentProvider,
  StripePaymentStatus,
} from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { applyStripePaymentSucceeded } from '@/lib/booking/writeBoundary'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MIN_AGE_MINUTES = 30
const MAX_AGE_HOURS = 72
const MAX_CANDIDATES_PER_RUN = 200

type RecoveryOutcome = {
  bookingId: string
  stripeCheckoutSessionId: string
  outcome:
    | 'recovered'
    | 'session_not_paid'
    | 'session_missing_payment_intent'
    | 'stripe_lookup_failed'
    | 'apply_failed'
    | 'no_op_or_already_recovered'
}

function readEnv(name: string): string | null {
  return process.env[name] ?? null
}

function getJobSecret(): string | null {
  return readEnv('INTERNAL_JOB_SECRET') ?? readEnv('CRON_SECRET')
}

function isAuthorizedJobRequest(req: Request): boolean {
  const secret = getJobSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const internalHeader = req.headers.get('x-internal-job-secret')
  if (internalHeader === secret) return true

  return false
}

function getStripePaymentIntentId(
  session: Stripe.Checkout.Session,
): string | null {
  if (typeof session.payment_intent === 'string') {
    return session.payment_intent
  }

  if (
    session.payment_intent &&
    typeof session.payment_intent === 'object' &&
    typeof session.payment_intent.id === 'string'
  ) {
    return session.payment_intent.id
  }

  return null
}

function getStripePaymentIntent(
  session: Stripe.Checkout.Session,
): Stripe.PaymentIntent | null {
  if (
    session.payment_intent &&
    typeof session.payment_intent === 'object' &&
    session.payment_intent.object === 'payment_intent'
  ) {
    return session.payment_intent
  }

  return null
}

async function recoverBooking(args: {
  bookingId: string
  stripeCheckoutSessionId: string
}): Promise<RecoveryOutcome> {
  const stripe = getStripe()

  let session: Stripe.Checkout.Session

  try {
    session = await stripe.checkout.sessions.retrieve(
      args.stripeCheckoutSessionId,
      { expand: ['payment_intent'] },
    )
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/stripe-orphan-recovery',
      event: 'STRIPE_LOOKUP_FAILED',
      bookingId: args.bookingId,
    })

    return {
      bookingId: args.bookingId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      outcome: 'stripe_lookup_failed',
    }
  }

  if (session.payment_status !== 'paid') {
    return {
      bookingId: args.bookingId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      outcome: 'session_not_paid',
    }
  }

  const paymentIntent = getStripePaymentIntent(session)
  const stripePaymentIntentId = getStripePaymentIntentId(session)

  if (!stripePaymentIntentId) {
    return {
      bookingId: args.bookingId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      outcome: 'session_missing_payment_intent',
    }
  }

  const amountReceivedCents =
    typeof paymentIntent?.amount_received === 'number'
      ? paymentIntent.amount_received
      : typeof session.amount_total === 'number'
        ? session.amount_total
        : null

  const currency =
    typeof paymentIntent?.currency === 'string'
      ? paymentIntent.currency
      : typeof session.currency === 'string'
        ? session.currency
        : null

  // Stable synthetic idempotency key for this recovery path.
  // If this job retries the same paid session, the write boundary can no-op
  // after the first successful recovery.
  const stripeEventId = `orphan_recovery:${args.stripeCheckoutSessionId}`

  try {
    const result = await applyStripePaymentSucceeded({
      bookingIdHint: args.bookingId,
      stripePaymentIntentId,
      stripeEventId,
      amountReceivedCents,
      currency,
    })

    return {
      bookingId: args.bookingId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      outcome:
        result && result.meta.mutated
          ? 'recovered'
          : 'no_op_or_already_recovered',
    }
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/stripe-orphan-recovery',
      event: 'APPLY_PAYMENT_FAILED',
      bookingId: args.bookingId,
    })

    return {
      bookingId: args.bookingId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      outcome: 'apply_failed',
    }
  }
}

async function runJob(req: Request): Promise<Response> {
  const secret = getJobSecret()

  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
      {
        code: 'STRIPE_ORPHAN_RECOVERY_SECRET_REQUIRED',
      },
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized', {
      code: 'UNAUTHORIZED',
    })
  }

  const now = new Date()
  const minCreatedBefore = new Date(now.getTime() - MIN_AGE_MINUTES * 60_000)
  const maxCreatedAfter = new Date(now.getTime() - MAX_AGE_HOURS * 3_600_000)

  const candidates = await prisma.booking.findMany({
    where: {
      paymentProvider: PaymentProvider.STRIPE,
      stripeCheckoutSessionId: { not: null },
      stripePaymentStatus: {
        not: StripePaymentStatus.SUCCEEDED,
      },
      paymentCollectedAt: null,
      status: {
        notIn: [BookingStatus.CANCELLED, BookingStatus.COMPLETED],
      },
      createdAt: {
        lte: minCreatedBefore,
        gte: maxCreatedAfter,
      },
    },
    select: {
      id: true,
      stripeCheckoutSessionId: true,
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_CANDIDATES_PER_RUN,
  })

  const results: RecoveryOutcome[] = []

  for (const candidate of candidates) {
    if (!candidate.stripeCheckoutSessionId) continue

    const outcome = await recoverBooking({
      bookingId: candidate.id,
      stripeCheckoutSessionId: candidate.stripeCheckoutSessionId,
    })

    results.push(outcome)
  }

  const tally = results.reduce<Record<RecoveryOutcome['outcome'], number>>(
    (acc, result) => {
      acc[result.outcome] = (acc[result.outcome] ?? 0) + 1
      return acc
    },
    {
      recovered: 0,
      session_not_paid: 0,
      session_missing_payment_intent: 0,
      stripe_lookup_failed: 0,
      apply_failed: 0,
      no_op_or_already_recovered: 0,
    },
  )

  return jsonOk(
    {
      ok: true,
      candidatesScanned: candidates.length,
      tally,
      sample: results.slice(0, 20),
      ranAt: now.toISOString(),
    },
    200,
  )
}

export async function GET(req: Request): Promise<Response> {
  return runJob(req)
}

export async function POST(req: Request): Promise<Response> {
  return runJob(req)
}