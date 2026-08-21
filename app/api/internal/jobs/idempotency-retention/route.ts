// app/api/internal/jobs/idempotency-retention/route.ts
//
// Cron: 40 9 * * * (daily)
// Deletes idempotency-ledger rows past their replay window. Those rows store a
// verbatim copy of the original API response, so leaving them forever means
// keeping user identity data forever — see lib/idempotency/retention.ts.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import {
  IDEMPOTENCY_RETENTION_DAYS,
  purgeExpiredIdempotencyKeys,
} from '@/lib/idempotency/retention'

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

  const { deleted, cutoff } = await purgeExpiredIdempotencyKeys()

  return jsonOk({
    deleted,
    cutoff: cutoff.toISOString(),
    retentionDays: IDEMPOTENCY_RETENTION_DAYS,
  })
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
