// app/api/internal/jobs/booking-series/roll-forward/route.ts
//
// Cron: 0 * * * * (hourly; see vercel.json)
//
// K20 (Phase 8) — advance every ACTIVE recurring appointment's materialization
// window. This is the operator that makes an OPEN-ENDED standing appointment a
// real thing rather than a batch of twelve that dead-stops (K18-B); K19 withheld
// the option from the pro's form until it existed.
//
// Hourly, not every few minutes: the window is 90 days deep, so nothing here is
// time-critical to the minute, and an hourly tick still catches up a stalled
// series within an hour of the condition clearing. The sweep is idempotent, so
// the cadence is a cost decision, not a correctness one.
//
// Kill switches, in order of blast radius:
//   - ENABLE_RECURRING_APPOINTMENTS unset (prod today) ⇒ the whole feature is
//     dark and this observes only.
//   - SERIES_ROLL_FORWARD_ENABLED=0 ⇒ the sweep observes only while the feature
//     stays live for everything else.
//
// Auth is the shared internal-job secret (INTERNAL_JOB_SECRET, falling back to
// CRON_SECRET), compared in constant time by `isAuthorizedJobRequest` — the same
// path every other job route uses. Nothing about the secret is handled here
// ([[public-repo-cron-secret-exposure]]).
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { rollForwardBookingSeries } from '@/lib/booking/series/rollForwardSweep'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

async function runJob(req: Request) {
  const secret = getInternalJobSecret()
  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const result = await rollForwardBookingSeries({ now: new Date() })

    return jsonOk({
      enabled: result.enabled,
      leadDays: result.leadDays,
      candidatesScanned: result.candidatesScanned,
      capped: result.capped,
      created: result.createdCount,
      skipped: result.skippedCount,
      tally: result.tally,
      ranAt: new Date().toISOString(),
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/booking-series/roll-forward',
      event: 'SERIES_ROLL_FORWARD_SWEEP_ERROR',
    })
    throw error
  }
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch {
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch {
    return jsonFail(500, 'Internal server error')
  }
}
