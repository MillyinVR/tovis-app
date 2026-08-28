// lib/notifications/delivery/kickNotificationDrain.ts
import { waitUntil } from '@vercel/functions'

import { captureNotificationException } from '@/lib/observability/notificationEvents'
import { safeError } from '@/lib/security/logging'

import { drainDueNotifications } from './runNotificationDrain'

/**
 * Fire-and-forget: drain freshly-enqueued notifications immediately, after the
 * current request's response is sent, so an email/SMS goes out in seconds
 * instead of waiting for the next cron tick.
 *
 * Call this from a request handler AFTER the enqueueing transaction has
 * committed (e.g. once the write-boundary call returns) — `waitUntil` defers the
 * drain until after the response, by which point the new delivery rows are
 * visible to the worker.
 *
 * Safe by construction:
 * - Never blocks or fails the request: the drain promise's rejection is
 *   swallowed, and `waitUntil` being unavailable (non-serverless / tests) is
 *   caught — the every-minute cron is the backstop either way.
 * - Concurrency-safe: claimDeliveries leases rows atomically, so overlapping
 *   with the cron or another kick never double-sends.
 */
export function kickNotificationDrain(args?: { batchSize?: number }): void {
  // Never fire a live drain inside the test runner. Many notification-emitting
  // routes call this, and a unit test exercising one of them must not kick off
  // real provider/DB work. The dedicated kickNotificationDrain test clears
  // VITEST to exercise the real scheduling behavior.
  if (process.env.VITEST) return

  const run = () =>
    drainDueNotifications({ batchSize: args?.batchSize }).catch(
      (error: unknown) => {
        console.error('kickNotificationDrain: drain failed', {
          error: safeError(error),
        })
        // The every-minute cron still backstops delivery, so this is latency,
        // not loss — but a PERSISTENT drain failure means every email/SMS in the
        // app is late, and the console line alone is invisible to Sentry
        // (SENTRY_ENABLE_LOGS is off by default).
        captureNotificationException({
          error,
          route: 'kickNotificationDrain',
          event: 'DRAIN_KICK_FAILED',
        })
      },
    )

  try {
    waitUntil(run())
  } catch (error: unknown) {
    // waitUntil is only available inside a serverless request scope. Outside one
    // (local dev edge cases, tests), fall back to the cron — never throw into
    // the caller's request path.
    console.warn('kickNotificationDrain: waitUntil unavailable; relying on cron', {
      error: safeError(error),
    })
    // Expected outside a serverless request scope (local dev, tests). In
    // PRODUCTION it never should be — and if it is, every notification in the
    // app silently degrades to cron-cadence. Warning level: the cron backstop
    // means nothing is lost, only delayed.
    captureNotificationException({
      error,
      route: 'kickNotificationDrain',
      event: 'WAIT_UNTIL_UNAVAILABLE',
      level: 'warning',
    })
  }
}
