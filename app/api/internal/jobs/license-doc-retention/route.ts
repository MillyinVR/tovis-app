// app/api/internal/jobs/license-doc-retention/route.ts
//
// Purges VerificationDocument raw files 90 days after their verification
// decision. See lib/licensing/verificationDocRetention.ts for the policy.
// Daily cadence is plenty (the retention window is measured in days). Auth
// matches the other internal jobs.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { runVerificationDocRetentionSweep } from '@/lib/licensing/verificationDocRetention'
import { captureLicensingException } from '@/lib/observability/licensingEvents'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROUTE = 'GET /api/internal/jobs/license-doc-retention'

async function handle(req: Request) {
  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const result = await runVerificationDocRetentionSweep(new Date())
    return jsonOk(result)
  } catch (error: unknown) {
    console.error('license-doc-retention sweep error', {
      error: safeError(error),
    })
    captureLicensingException({
      error,
      route: ROUTE,
      event: 'LICENSE_DOC_RETENTION_SWEEP_ERROR',
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
