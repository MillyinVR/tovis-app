// app/api/internal/jobs/nfc/tap-intent-cleanup/route.ts
//
// Reaps expired NFC TapIntents (see lib/nfc/cleanupTapIntents.ts). The grace
// window is 30 minutes, so a daily cadence is plenty. Auth matches the other
// internal jobs (Bearer INTERNAL_JOB_SECRET / CRON_SECRET).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { prisma } from '@/lib/prisma'
import { pruneExpiredTapIntents } from '@/lib/nfc/cleanupTapIntents'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(req: Request) {
  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const deleted = await pruneExpiredTapIntents(prisma, new Date())
    return jsonOk({ deleted })
  } catch (error: unknown) {
    console.error('POST /api/internal/jobs/nfc/tap-intent-cleanup error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  return handle(req)
}
