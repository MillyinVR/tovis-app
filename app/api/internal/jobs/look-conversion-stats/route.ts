// app/api/internal/jobs/look-conversion-stats/route.ts
//
// Cron: 40 * * * * (hourly; see vercel.json)
//
// Refreshes LookPostConversionStat — the per-LOOK booking-conversion aggregate
// behind the Looks feed booking_conversion_rate term (personalization spec §4.2,
// lib/looks/conversionStats.ts). Hourly so a look's "fills chairs" quality tracks
// bookings taken through the day; if the job stops, the signal goes stale (rows
// keep their last values) rather than wrong — and since conversion is a SOFT
// weight, a stale soft nudge degrades gracefully. Offset from the pro-badge-stats
// (10 * * * *) and pro-availability-stats (25 * * * *) jobs so the three §4.2
// aggregates don't contend.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { refreshLookPostConversionStats } from '@/lib/looks/conversionStats'
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
    const result = await refreshLookPostConversionStats(prisma, new Date())

    return jsonOk({
      looks: result.looks,
      computedAt: result.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/look-conversion-stats error', {
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
