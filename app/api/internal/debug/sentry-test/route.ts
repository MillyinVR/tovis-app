// app/api/internal/debug/sentry-test/route.ts

import * as Sentry from '@sentry/nextjs'

import { jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

function getJobSecret(): string | null {
  return readEnv('INTERNAL_JOB_SECRET') ?? readEnv('CRON_SECRET')
}

function isAuthorized(req: Request): boolean {
  const secret = getJobSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const internalHeader = req.headers.get('x-internal-job-secret')
  if (internalHeader === secret) return true

  return false
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    const enabled = readEnv('ENABLE_SENTRY_DEBUG_ROUTE')

    if (enabled !== 'true') {
      return jsonFail(404, 'Not found.')
    }
  }

  if (!isAuthorized(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  const eventId = Sentry.captureException(
    new Error('TOVIS synthetic Sentry test event'),
    {
      tags: {
        area: 'launch-readiness',
        source: 'sentry-debug-route',
        synthetic: 'true',
      },
      level: 'error',
    },
  )

  await Sentry.flush(2000)

  return jsonOk(
    {
      ok: true,
      eventId,
      message: 'Synthetic Sentry event captured.',
    },
    200,
  )
}