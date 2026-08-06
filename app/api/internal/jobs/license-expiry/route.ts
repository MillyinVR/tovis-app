// app/api/internal/jobs/license-expiry/route.ts
//
// Warns pros ahead of a license expiry and notifies them once it has passed.
// See lib/licensing/licenseExpiryNotifications.ts for the policy. Daily
// cadence is plenty (the warn window is measured in days). Auth matches the
// other internal jobs.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { runLicenseExpiryNotifications } from '@/lib/licensing/licenseExpiryNotifications'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(req: Request) {
  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const result = await runLicenseExpiryNotifications(new Date())
    return jsonOk(result)
  } catch (error: unknown) {
    console.error('license-expiry sweep error', {
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
