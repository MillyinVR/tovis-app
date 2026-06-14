// app/api/internal/jobs/upload-sessions/cleanup/route.ts
//
// Reaps abandoned UploadSessions: rows that were signed (and possibly had bytes
// pushed to storage) but never attached to a MediaAsset before their TTL. Flips
// PENDING -> EXPIRED past expiresAt. A storage sweep can then delete the orphan
// objects those expired sessions point at.
//
// Auth matches the other internal jobs (Bearer INTERNAL_JOB_SECRET / CRON_SECRET).

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import { prisma } from '@/lib/prisma'
import { expireStaleUploadSessions } from '@/lib/media/uploadSession'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  try {
    const expired = await expireStaleUploadSessions(prisma, new Date())
    return jsonOk({ expired })
  } catch (error: unknown) {
    console.error('POST /api/internal/jobs/upload-sessions/cleanup error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}
