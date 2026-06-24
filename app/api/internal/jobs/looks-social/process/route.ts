// app/api/internal/jobs/looks-social/process/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import {
  processLooksSocialJobs,
  type ProcessLooksSocialJobsResult,
} from '@/lib/jobs/looksSocial/process'
import { logLooksSocialJobBatchEvent } from '@/lib/observability/looksSocialJobEvents'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_TAKE = 100
const MAX_TAKE = 250
const ROUTE = 'internal.jobs.looks_social.process'

type JobMethod = 'GET' | 'POST'

function readTake(req: Request): number {
  const url = new URL(req.url)
  const raw = url.searchParams.get('take')
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TAKE

  if (!Number.isFinite(parsed)) return DEFAULT_TAKE
  return Math.max(1, Math.min(MAX_TAKE, parsed))
}

function createBatchId(): string {
  return crypto.randomUUID()
}

function resolveFinishedLogLevel(
  result: ProcessLooksSocialJobsResult,
): 'info' | 'warn' {
  if (result.retryScheduledCount > 0) return 'warn'
  if (result.failedCount > 0) return 'warn'
  if (result.processedCount !== result.scannedCount) return 'warn'
  return 'info'
}

async function runJob(
  req: Request,
  method: JobMethod,
  batchId: string,
) {
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
  const startedAtMs = Date.now()

  logLooksSocialJobBatchEvent({
    level: 'info',
    event: 'looks_social.jobs.batch.started',
    route: ROUTE,
    batchId,
    method,
    take,
  })

  const now = new Date()
  const processedAt = now.toISOString()

  const result = await processLooksSocialJobs({
    now,
    batchSize: take,
  })

  logLooksSocialJobBatchEvent({
    level: resolveFinishedLogLevel(result),
    event: 'looks_social.jobs.batch.finished',
    route: ROUTE,
    batchId,
    method,
    take,
    processedAt,
    durationMs: Date.now() - startedAtMs,
    scannedCount: result.scannedCount,
    processedCount: result.processedCount,
    completedCount: result.completedCount,
    retryScheduledCount: result.retryScheduledCount,
    failedCount: result.failedCount,
    perTypeCounts: result.perTypeCounts,
  })

  return jsonOk({
    ...result,
    take,
    processedAt,
  })
}

export async function GET(req: Request) {
  const batchId = createBatchId()

  try {
    return await runJob(req, 'GET', batchId)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error'

    logLooksSocialJobBatchEvent({
      level: 'error',
      event: 'looks_social.jobs.batch.exception',
      route: ROUTE,
      batchId,
      method: 'GET',
      message,
      meta: {
        errorName: error instanceof Error ? error.name : 'NonErrorThrown',
      },
    })

    return jsonFail(500, message)
  }
}

export async function POST(req: Request) {
  const batchId = createBatchId()

  try {
    return await runJob(req, 'POST', batchId)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error'

    logLooksSocialJobBatchEvent({
      level: 'error',
      event: 'looks_social.jobs.batch.exception',
      route: ROUTE,
      batchId,
      method: 'POST',
      message,
      meta: {
        errorName: error instanceof Error ? error.name : 'NonErrorThrown',
      },
    })

    return jsonFail(500, message)
  }
}