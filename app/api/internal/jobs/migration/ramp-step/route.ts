// app/api/internal/jobs/migration/ramp-step/route.ts
//
// Cron: 0 8 * * * (daily; see vercel.json)
//
// Advances every due price-grace ramp (see lib/migration/rampStepJob). Ramps
// only exist once a pro has migrated a below-minimum service menu, so this is a
// no-op until the migration flow is in use. advanceRamp catches up missed
// ticks, so a daily cadence comfortably serves the 10%/10-week policy floor.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { runRampStep } from '@/lib/migration/rampStepJob'

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

  const summary = await runRampStep({ now: new Date() })
  return jsonOk(summary)
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
