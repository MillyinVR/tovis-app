// app/api/internal/jobs/looks-category-trend-stats/route.ts
//
// Cron: 50 9 * * * (daily; see vercel.json)
//
// Refreshes LookCategoryTrendStat — the per-family RECENT engagement aggregate
// behind the engagement-driven ordering of the camera shot packs (camera-perfect
// C10, lib/looks/categoryTrendStats.ts → lib/pro/cameraShotPacks.ts). Trend moves
// on category-population timescales, so daily is plenty; between refreshes the
// GET /pro/camera/shot-packs route reads the standing rows. An empty/missing
// table simply leaves the shot packs in their editorial order — this job can
// never make the camera worse than its pre-C10 behavior. Offset from the
// looks-category-rank-stats job (45 9) so the two aggregates don't contend.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { refreshLookCategoryTrendStats } from '@/lib/looks/categoryTrendStats'
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
    const result = await refreshLookCategoryTrendStats(prisma, new Date())

    return jsonOk({
      families: result.families,
      windowDays: result.windowDays,
      computedAt: result.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/looks-category-trend-stats error', {
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
