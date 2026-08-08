// app/api/internal/jobs/upload-sessions/cleanup/route.ts
//
// Reaps abandoned media UploadSessions and runs the stricter consult raw-object
// sweep. Generic media behavior remains status-only; CLIENT_CONSULT is marked
// expired/purged only after private storage confirms the object is absent.
//
// Cron: */15 * * * * (every 15 minutes). Scheduled in vercel.json. Vercel cron
// invokes via GET; the POST export stays for manual/internal triggers.
//
// Auth matches the other internal jobs (Bearer INTERNAL_JOB_SECRET / CRON_SECRET).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { prisma } from '@/lib/prisma'
import { expireStaleUploadSessions } from '@/lib/media/uploadSession'
import { runConsultCapturePurgeSweep } from '@/lib/consult/capturePurge'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

async function runJob(req: Request) {
  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const now = new Date()
    const [expired, consultRaw] = await Promise.all([
      expireStaleUploadSessions(prisma, now),
      runConsultCapturePurgeSweep(now),
    ])
    return jsonOk({ expired, consultRaw })
  } catch (error: unknown) {
    console.error('/api/internal/jobs/upload-sessions/cleanup error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
