// app/api/internal/jobs/looks-category-rank-stats/route.ts
//
// Cron: 30 9 * * * (daily; see vercel.json)
//
// Refreshes LookCategoryRankStat — the per-service-category engagement
// aggregate behind the per-category Bayesian prior in Look rank scoring
// (personalization spec §4.1, lib/looks/categoryRankStats.ts). Priors move on
// category-population timescales, so daily is plenty; between refreshes every
// rank recompute reads the standing rows. An empty/missing row simply means
// the global prior — this job can never make scoring worse than pre-prior
// behavior.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { refreshLookCategoryRankStats } from '@/lib/looks/categoryRankStats'
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
    const result = await refreshLookCategoryRankStats(prisma, new Date())

    return jsonOk({
      categories: result.categories,
      computedAt: result.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/looks-category-rank-stats error', {
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
