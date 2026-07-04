// app/api/internal/jobs/notifications/digest/route.ts
//
// Weekly social digest email cron (social-first C3). Batches each recipient's
// unread social notifications into one Postmark email. Internal-auth guarded
// like every other cron; no-ops cleanly when Postmark is unconfigured.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import {
  DEFAULT_DIGEST_MAX_RECIPIENTS,
  DEFAULT_DIGEST_WINDOW_DAYS,
  MAX_DIGEST_MAX_RECIPIENTS,
  MAX_DIGEST_WINDOW_DAYS,
  MIN_DIGEST_WINDOW_DAYS,
} from '@/lib/notifications/socialDigest/constants'
import { runSocialDigest } from '@/lib/notifications/socialDigest/runDigest'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

function readIntParam(
  req: Request,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = new URL(req.url).searchParams.get(name)
  const parsed = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

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

  const windowDays = readIntParam(
    req,
    'days',
    DEFAULT_DIGEST_WINDOW_DAYS,
    MIN_DIGEST_WINDOW_DAYS,
    MAX_DIGEST_WINDOW_DAYS,
  )
  const maxRecipients = readIntParam(
    req,
    'max',
    DEFAULT_DIGEST_MAX_RECIPIENTS,
    1,
    MAX_DIGEST_MAX_RECIPIENTS,
  )
  const now = new Date()

  const result = await runSocialDigest({ now, windowDays, maxRecipients })

  return jsonOk({ ...result, processedAt: now.toISOString() })
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('GET /api/internal/jobs/notifications/digest error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('POST /api/internal/jobs/notifications/digest error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Internal server error')
  }
}
