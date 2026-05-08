// app/api/internal/jobs/stripe-orphan-recovery/route.ts
//
// Cron: */10 * * * * (every 10 minutes)
// Recovers bookings where Stripe collected payment but the
// payment_intent.succeeded webhook never reached the write boundary
// (lost webhook, transient outage, etc.).
//
// For each candidate booking — has stripeCheckoutSessionId, has no
// paymentCollectedAt, isn't COMPLETED/CANCELLED, was created at least
// MIN_AGE_MINUTES ago to give the normal webhook flow time to run —
// we ask Stripe whether the session is actually paid. If yes, we
// replay applyStripePaymentSucceeded with the synthetic event id
// so the write boundary's existing idempotency guard either applies
// the pending state or no-ops on a duplicate.
//
// Failures are logged per-booking; a single bad session never blocks
// the rest of the sweep.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { applyStripePaymentSucceeded } from '@/lib/booking/writeBoundary'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'
import { BookingStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MIN_AGE_MINUTES = 30
const MAX_AGE_HOURS = 72
const MAX_CANDIDATES_PER_RUN = 200

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

async function recoverBooking(args: {
  bookingId: string
  stripeCheckoutSessionId: string
}): Promise<RecoveryOutcome> {
  const stripe = getStripe()

  let session
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

  const paymentIntent =
    typeof session.payment_intent === 'string'
      ? null
      : (session.payment_intent ?? null)
  const stripePaymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (paymentIntent?.id ?? null)

  if (!stripePaymentIntentId) {
    return {
      bookingId: args.bookingId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      outcome: 'session_missing_payment_intent',
    }
  }

  const amountReceivedCents =
    paymentIntent && typeof paymentIntent.amount_received === 'number'
      ? paymentIntent.amount_received
      : typeof session.amount_total === 'number'
        ? session.amount_total
        : null
  const currency =
    paymentIntent && typeof paymentIntent.currency === 'string'
      ? paymentIntent.currency
      : typeof session.currency === 'string'
        ? session.currency
        : null

  // Synthetic event id keyed off the session lets the write-boundary's
  // idempotency on `stripeLastEventId` no-op if the real webhook already
  // applied the same state.
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

async function runJob(req: Request) {
  const secret = getJobSecret()
  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  const now = new Date()
  const minCreatedBefore = new Date(now.getTime() - MIN_AGE_MINUTES * 60_000)
  const maxCreatedAfter = new Date(now.getTime() - MAX_AGE_HOURS * 3600_000)

  const candidates = await prisma.booking.findMany({
    where: {
      stripeCheckoutSessionId: { not: null },
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
    (acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1
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

  return jsonOk({
    candidatesScanned: candidates.length,
    tally,
    ranAt: now.toISOString(),
  })
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
