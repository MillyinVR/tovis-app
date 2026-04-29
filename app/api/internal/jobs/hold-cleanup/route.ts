// app/api/internal/jobs/hold-cleanup/route.ts
//
// Cron: */5 * * * * (every 5 minutes)
// Deletes expired BookingHold rows so stale holds never permanently lock slots.
//
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function readEnv(name: string): string | null {
  return process.env[name] ?? null
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

  const now = new Date()

  const result = await prisma.bookingHold.deleteMany({
    where: {
      expiresAt: { lte: now },
    },
  }).catch((err: unknown) => {
    captureBookingException({ error: err, route: 'GET /api/internal/jobs/hold-cleanup', event: 'HOLD_SWEEP_ERROR' })
    throw err
  })

  return jsonOk({
    deleted: result.count,
    ranAt: now.toISOString(),
  })
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
