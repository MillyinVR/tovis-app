// app/api/internal/jobs/notifications/process/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import {
  drainDueNotifications,
  NOTIFICATION_DRAIN_DEFAULT_BATCH,
  NOTIFICATION_DRAIN_MAX_BATCH,
} from '@/lib/notifications/delivery/runNotificationDrain'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function readTake(req: Request): number {
  const url = new URL(req.url)
  const raw = url.searchParams.get('take')
  const parsed = raw ? Number.parseInt(raw, 10) : NOTIFICATION_DRAIN_DEFAULT_BATCH

  if (!Number.isFinite(parsed)) return NOTIFICATION_DRAIN_DEFAULT_BATCH
  return Math.max(1, Math.min(NOTIFICATION_DRAIN_MAX_BATCH, parsed))
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

  const take = readTake(req)
  const now = new Date()

  const result = await drainDueNotifications({ batchSize: take, now })

  return jsonOk({
    ...result,
    take,
    processedAt: now.toISOString(),
  })
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('GET /api/internal/jobs/notifications/process error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('POST /api/internal/jobs/notifications/process error', {
      error: safeError(err),
    })

    return jsonFail(500, 'Internal server error')
  }
}