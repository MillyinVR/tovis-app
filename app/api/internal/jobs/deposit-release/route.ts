// app/api/internal/jobs/deposit-release/route.ts
//
// Cron: */15 * * * * (every 15 minutes; see vercel.json)
//
// Releases abandoned new-client discovery-deposit holds (M5): a booking whose
// deposit was never paid squats the pro's calendar because the deposit was meant
// to secure the slot and nothing else frees it. Once an unpaid deposit is older
// than the deadline (DEPOSIT_UNPAID_DEADLINE_HOURS, default 24), this cancels
// the booking (SYSTEM provenance), freeing the slot, and notifies the client to
// rebook.
//
// Kill switch: DEPOSIT_AUTO_RELEASE_ENABLED (default on). When off, the sweep
// only observes and logs candidate counts — nothing is released.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { releaseAbandonedDepositBookings } from '@/lib/booking/depositReleaseSweep'
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
    const result = await releaseAbandonedDepositBookings({ now: new Date() })

    return jsonOk({
      enabled: result.enabled,
      deadlineHours: result.deadlineHours,
      candidatesScanned: result.candidatesScanned,
      released: result.releasedCount,
      capped: result.capped,
      tally: result.tally,
      ranAt: new Date().toISOString(),
    })
  } catch (error: unknown) {
    captureBookingException({
      error,
      route: 'GET /api/internal/jobs/deposit-release',
      event: 'DEPOSIT_RELEASE_SWEEP_ERROR',
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
