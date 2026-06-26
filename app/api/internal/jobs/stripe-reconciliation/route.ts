// app/api/internal/jobs/stripe-reconciliation/route.ts
//
// Cron: 0 * * * * (hourly)
//
// Heals booking refund state that drifted from Stripe because a charge.refunded
// webhook was lost, or because a refund was issued straight from the Stripe
// Dashboard (which creates no BookingRefund row). For each recently-paid Stripe
// booking we ask Stripe for the authoritative refunded total and re-drive the
// same reconcile path the webhook uses. The heal is idempotent, so a booking
// already in sync is a cheap no-op. Both the final-bill charge and the separate
// new-client deposit charge are swept.
//
// Per-booking failures are captured and tallied; one bad PaymentIntent never
// blocks the rest of the sweep.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import {
  reconcileStripeDeposits,
  reconcileStripeRefunds,
  type ReconcileRunResult,
} from '@/lib/booking/stripeReconciliation'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function runJob(req: Request): Promise<Response> {
  const secret = getInternalJobSecret()
  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
      { code: 'STRIPE_RECONCILIATION_SECRET_REQUIRED' },
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized', { code: 'UNAUTHORIZED' })
  }

  const now = new Date()

  try {
    // Final-bill and deposit charges are independent PaymentIntents; sweep both.
    const [refunds, deposits] = await Promise.all([
      reconcileStripeRefunds({ now }),
      reconcileStripeDeposits({ now }),
    ])

    const shape = (run: ReconcileRunResult) => ({
      candidatesScanned: run.candidatesScanned,
      capped: run.capped,
      tally: run.tally,
      capturedAmountDriftCount: run.capturedAmountDriftCount,
      sample: run.results.slice(0, 20),
    })

    return jsonOk({
      ok: true,
      refunds: shape(refunds),
      deposits: shape(deposits),
      ranAt: now.toISOString(),
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/stripe-reconciliation',
      event: 'STRIPE_RECONCILIATION_SWEEP_ERROR',
    })
    throw error
  }
}

export async function GET(req: Request): Promise<Response> {
  return runJob(req)
}

export async function POST(req: Request): Promise<Response> {
  return runJob(req)
}
