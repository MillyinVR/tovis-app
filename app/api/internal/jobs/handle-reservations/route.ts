// app/api/internal/jobs/handle-reservations/route.ts
//
// Releases stale vanity-handle reservations held by non-premium pros, after a heads-up
// warning. See lib/handles/reservationExpiry.ts for the policy. Daily cadence is plenty
// (the grace window is measured in days). Auth matches the other internal jobs.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { runHandleReservationExpiry } from '@/lib/handles/reservationExpiry'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(req: Request) {
  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const result = await runHandleReservationExpiry(new Date())
    return jsonOk(result)
  } catch (error: unknown) {
    console.error('POST /api/internal/jobs/handle-reservations error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  return handle(req)
}
