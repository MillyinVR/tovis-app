// app/api/internal/jobs/pro-availability-stats/route.ts
//
// Cron: 25 * * * * (hourly; see vercel.json)
//
// Refreshes ProfessionalAvailabilityStat — the per-pro calendar-availability
// aggregate behind the Looks feed availability_boost term (personalization spec
// §4.2/§4.4, lib/looks/availabilityStats.ts). Hourly so "next opening" and
// 14-day fullness track bookings taken through the day; if the job stops, the
// signal goes stale (rows keep their last values) rather than wrong — and since
// availability is a SOFT weight, a stale soft nudge degrades gracefully. Offset
// from the pro-badge-stats job (10 * * * *) so the two aggregates don't contend.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { refreshProfessionalAvailabilityStats } from '@/lib/looks/availabilityStats'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

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
    const result = await refreshProfessionalAvailabilityStats(prisma, new Date())

    return jsonOk({
      professionals: result.professionals,
      computedAt: result.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/pro-availability-stats error', {
      error: safeError(error),
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
