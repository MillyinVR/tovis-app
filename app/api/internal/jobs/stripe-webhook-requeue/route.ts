// app/api/internal/jobs/stripe-webhook-requeue/route.ts
//
// Cron: */15 * * * *
//
// Re-drives Stripe webhook events whose live delivery failed and whose native
// Stripe retries are exhausted (failedAt set, processedAt still null). Each is
// replayed through the same handleStripeEvent path the live route uses; the
// handler is idempotent, so a replay is safe. Per-event failures are captured
// and tallied; one bad event never blocks the rest of the sweep.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { requeueFailedStripeWebhookEvents } from '@/lib/stripe/requeueFailedWebhookEvents'
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
      { code: 'STRIPE_WEBHOOK_REQUEUE_SECRET_REQUIRED' },
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized', { code: 'UNAUTHORIZED' })
  }

  const now = new Date()

  try {
    const run = await requeueFailedStripeWebhookEvents({ now })

    return jsonOk({
      ok: true,
      candidatesScanned: run.candidatesScanned,
      capped: run.capped,
      tally: run.tally,
      sample: run.results.slice(0, 20),
      ranAt: now.toISOString(),
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/stripe-webhook-requeue',
      event: 'STRIPE_WEBHOOK_REQUEUE_SWEEP_ERROR',
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
