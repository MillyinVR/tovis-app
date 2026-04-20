// app/api/internal/jobs/looks-social/process/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { processLooksSocialJobs } from '@/lib/jobs/looksSocial/process'

export const dynamic = 'force-dynamic'

const DEFAULT_TAKE = 100
const MAX_TAKE = 250

function readTake(req: Request): number {
  const url = new URL(req.url)
  const raw = url.searchParams.get('take')
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TAKE

  if (!Number.isFinite(parsed)) return DEFAULT_TAKE
  return Math.max(1, Math.min(MAX_TAKE, parsed))
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

function getJobSecret(): string | null {
  return readEnv('INTERNAL_JOB_SECRET') ?? readEnv('CRON_SECRET')
}

function isAuthorizedJobRequest(req: Request): boolean {
  const secret = getJobSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const internalHeader = req.headers.get('x-internal-job-secret')
  if (internalHeader === secret) return true

  return false
}

async function runJob(req: Request) {
  const secret = getJobSecret()
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

  const result = await processLooksSocialJobs({
    now,
    batchSize: take,
  })

  return jsonOk({
    ...result,
    take,
    processedAt: now.toISOString(),
  })
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (error: unknown) {
    console.error('GET /api/internal/jobs/looks-social/process error', error)
    const message =
      error instanceof Error ? error.message : 'Internal server error'
    return jsonFail(500, message)
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (error: unknown) {
    console.error('POST /api/internal/jobs/looks-social/process error', error)
    const message =
      error instanceof Error ? error.message : 'Internal server error'
    return jsonFail(500, message)
  }
}