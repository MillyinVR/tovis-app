// app/api/internal/jobs/membership-comp-expiry/route.ts
//
// Clears expired admin-granted membership comps and recomputes the isPremium
// backfill for each affected pro. Entitlement reads already ignore an expired
// comp (compUntil comparison), so daily cadence is plenty — this job only
// keeps rows tidy and the custom-handle gate honest. Auth matches the other
// internal jobs.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { runMembershipCompExpiry } from '@/lib/membership/comp'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(req: Request) {
  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const result = await runMembershipCompExpiry(new Date())
    return jsonOk(result)
  } catch (error: unknown) {
    console.error('POST /api/internal/jobs/membership-comp-expiry error', {
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
