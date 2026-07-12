// app/api/internal/jobs/pro-badge-stats/route.ts
//
// Cron: 10 * * * * (hourly; see vercel.json)
//
// Refreshes ProfessionalBadgeStat — the per-pro booking aggregates behind the
// stat-derived Looks feed badges (personalization spec §5,
// lib/looks/badges/stats.ts). Hourly because the urgency badge ("Booking
// fast") measures a 48h window and carries a 6h staleness TTL (spec §5.7.4):
// if this job stops running, urgency badges stop RENDERING rather than
// showing stale scarcity — the failure mode is silence, not dishonesty.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { refreshProfessionalBadgeStats } from '@/lib/looks/badges/stats'
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
    const result = await refreshProfessionalBadgeStats(prisma, new Date())

    return jsonOk({
      professionals: result.professionals,
      computedAt: result.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/pro-badge-stats error', {
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
