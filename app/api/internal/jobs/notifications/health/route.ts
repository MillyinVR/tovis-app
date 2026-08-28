// app/api/internal/jobs/notifications/health/route.ts
//
// Scheduled health probe for the notification delivery queue. Computes a snapshot
// (stuck/overdue deliveries, terminal failures, top error codes) and, when it's
// unhealthy, raises a Sentry alert + structured log so delivery problems surface
// proactively instead of via a client complaint. Always returns the summary.
import * as Sentry from '@sentry/nextjs'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { evaluateNotificationDeliveryHealth } from '@/lib/notifications/delivery/notificationDeliveryHealth'
import { captureScheduledJobException } from '@/lib/observability/scheduledJobEvents'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

  const health = await evaluateNotificationDeliveryHealth()

  if (!health.healthy) {
    // Structured log first so it shows up in Vercel logs even without Sentry.
    console.error('notification delivery health degraded', { health })

    Sentry.withScope((scope) => {
      scope.setLevel('warning')
      scope.setTag('subsystem', 'notification-delivery')
      scope.setContext('notificationDeliveryHealth', {
        windowMinutes: health.windowMinutes,
        stuckCount: health.stuckCount,
        failedFinalCount: health.failedFinalCount,
        failedRetryableCount: health.failedRetryableCount,
        credentialRejectedCount: health.credentialRejectedCount,
        countsByStatus: health.countsByStatus,
        topErrorCodes: health.topErrorCodes,
        providerConfigIssues: health.providerConfigIssues,
        reasons: health.reasons,
      })
      Sentry.captureMessage('Notification delivery health degraded')
    })
  }

  return jsonOk(health)
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('GET /api/internal/jobs/notifications/health error', {
      error: safeError(err),
    })
    // This job IS the alarm for the delivery queue. If it throws, every
    // downstream signal keeps looking healthy precisely because nothing is
    // measuring it any more — so its own failure cannot be console-only.
    captureScheduledJobException({
      error: err,
      job: '/api/internal/jobs/notifications/health',
      event: 'NOTIFICATION_DELIVERY_HEALTH_PROBE_ERROR',
    })
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('POST /api/internal/jobs/notifications/health error', {
      error: safeError(err),
    })
    // Same reasoning as GET above: the watchdog's own failure is unwatched.
    captureScheduledJobException({
      error: err,
      job: '/api/internal/jobs/notifications/health',
      event: 'NOTIFICATION_DELIVERY_HEALTH_PROBE_ERROR',
    })
    return jsonFail(500, 'Internal server error')
  }
}
