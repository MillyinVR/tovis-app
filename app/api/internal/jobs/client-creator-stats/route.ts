// app/api/internal/jobs/client-creator-stats/route.ts
//
// Cron: 55 * * * * (hourly; see vercel.json)
//
// Refreshes the two client-creator aggregates:
//   • ClientCreatorStat — a creator's saves percentile and tier, shown as
//     "✦ Tastemaker · top 5% saver" on the public profile
//     (lib/clients/creatorTier.ts);
//   • ClientLookTrendStat — per-look weekly save momentum, shown as
//     "+84 saves this week · top 3% in Brooklyn" on /client/activity
//     (lib/clients/lookTrend.ts).
//
// ONE job, not two. Both are population statements over the same rows (the
// client-authored public looks and the saves on them), so running them on one
// schedule means they cannot be computed against different clocks — and there is
// one cron entry to reason about rather than two that can drift apart.
//
// Hourly, and offset to :55 so it doesn't contend with the other hourly
// aggregates (pro-badge-stats :10, pro-availability-stats :25,
// look-conversion-stats :40). A percentile is a statement about the whole
// population, so it can't be computed per-request on a public page; if the job
// stops, tiers go STALE rather than wrong — every row keeps its last value and
// its `computedAt`, and an unscored creator renders as no badge rather than as
// a demotion.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { refreshClientCreatorStats } from '@/lib/clients/creatorTier'
import { refreshClientLookTrendStats } from '@/lib/clients/lookTrend'
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
    // One clock for both aggregates: the tier's percentile and the trending
    // window are statements about the same population at the same instant.
    const now = new Date()

    // Sequential, not concurrent. Each replaces its whole table inside its own
    // transaction, and running two table-wide delete+insert pairs against the
    // same connection pool at once buys nothing on an hourly job.
    const creators = await refreshClientCreatorStats(prisma, now)
    const trends = await refreshClientLookTrendStats(prisma, now)

    return jsonOk({
      scored: creators.scored,
      ranked: creators.ranked,
      trendingLooks: trends.trending,
      trendingLooksRankedInCity: trends.ranked,
      trendWindowStart: trends.windowStart.toISOString(),
      computedAt: creators.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/client-creator-stats error', {
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
