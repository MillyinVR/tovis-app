// app/api/internal/debug/sentry-test/route.ts

import * as Sentry from '@sentry/nextjs'
import { jsonFail, jsonOk } from '@/app/api/_utils'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const SYNTHETIC_ALERT_MESSAGE = 'TOVIS production-safe synthetic Sentry alert v2'
const SYNTHETIC_ALERT_KEY = 'launch-readiness.synthetic-sentry-alert.v2'
const SYNTHETIC_ALERT_SOURCE = 'sentry-debug-route'
function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}
function getJobSecret(): string | null {
  return readEnv('INTERNAL_JOB_SECRET') ?? readEnv('CRON_SECRET')
}
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}
function isDebugRouteEnabled(): boolean {
  if (!isProduction()) return true
  return readEnv('ENABLE_SENTRY_DEBUG_ROUTE') === 'true'
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
  if (!isDebugRouteEnabled()) {
    return jsonFail(404, 'Not found.')
  }
  if (!isAuthorized(req)) {
    return jsonFail(401, 'Unauthorized')
  }
  const eventId = Sentry.captureException(new Error(SYNTHETIC_ALERT_MESSAGE), {
    level: 'error',
    tags: {
      alert_key: SYNTHETIC_ALERT_KEY,
      area: 'launch-readiness',
      launch_phase: 'phase-2',
      source: SYNTHETIC_ALERT_SOURCE,
      synthetic: 'true',
    },
    fingerprint: [SYNTHETIC_ALERT_KEY],
    contexts: {
      launch_readiness: {
        purpose: 'production-safe synthetic alert routing proof',
        route: 'POST /api/internal/debug/sentry-test',
        runbook: 'docs/runbooks/health-readiness.md',
      },
    },
  })
  await Sentry.flush(2000)
  return jsonOk(
    {
      eventId,
      message: 'Synthetic Sentry event captured.',
      alertKey: SYNTHETIC_ALERT_KEY,
      alertMessage: SYNTHETIC_ALERT_MESSAGE,
      alertSource: SYNTHETIC_ALERT_SOURCE,
      expectedSlackDestination: '#tovis-ops-alerts',
    },
    200,
  )
}