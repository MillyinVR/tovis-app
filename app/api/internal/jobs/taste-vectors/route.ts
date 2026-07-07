// app/api/internal/jobs/taste-vectors/route.ts
//
// Cron: 0 10 * * * (daily; see vercel.json)
//
// Recomputes the §6.0 visual taste vectors — global per client, local per
// board — as decayed, signal-weighted averages of the embeddings of
// liked/saved looks (lib/personalization/tasteVectors.ts). Daily is enough:
// the 75-day affinity half-life moves slowly, and every recompute is
// from-scratch so the sweep also absorbs newly embedded looks and deleted
// signals. Vectors are dark-loaded until the ranking pass consumes them, so
// this job can never make feeds worse.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { refreshTasteVectors } from '@/lib/personalization/tasteVectors'
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
    const result = await refreshTasteVectors(prisma, new Date())

    return jsonOk({
      clientsScanned: result.clientsScanned,
      clientsStored: result.clientsStored,
      boardsScanned: result.boardsScanned,
      boardsStored: result.boardsStored,
      computedAt: result.computedAt.toISOString(),
    })
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/taste-vectors error', {
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
