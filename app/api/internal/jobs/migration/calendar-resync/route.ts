// app/api/internal/jobs/migration/calendar-resync/route.ts
//
// Cron: 0 * * * * (hourly; see vercel.json)
//
// Re-fetches every connected calendar feed and re-runs the import (idempotent on
// event UID), so a migrating pro's new appointments flow in during the
// transition. Inert until a pro connects a feed subscription.
//
// Behind ENABLE_PRO_MIGRATION like every other surface of this flow. It was the
// one that wasn't: with the flag off no pro can create a subscription, so the job
// was inert *in practice* — but "no rows yet" is not a gate, and a subscription
// left behind by a flag that was once on would keep writing bookings and blocks
// from a remote URL after the flow was switched back off.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { runCalendarResync } from '@/lib/migration/calendarResync'
import { isProMigrationEnabled } from '@/lib/migration/featureFlag'

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

  // After the secret check, so an unauthorized caller cannot probe the flag.
  if (!isProMigrationEnabled()) {
    return jsonOk({ skipped: 'PRO_MIGRATION_DISABLED' })
  }

  const summary = await runCalendarResync({ now: new Date() })
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
