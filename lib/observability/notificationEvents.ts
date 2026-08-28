// lib/observability/notificationEvents.ts
//
// Structured Sentry capture for notification-delivery errors. Mirrors
// captureLicensingException in licensingEvents.ts and captureAuthException in
// authEvents.ts but tags by notification-delivery context.
//
// This exists because the delivery pipeline's degradations are deliberately
// non-fatal — a failed short-link mint logs and falls back to the long URL
// rather than dropping the message — and a console.error alone reaches Sentry
// only as a LOG, and only when SENTRY_ENABLE_LOGS is on (it defaults to false,
// see lib/observability/sentryConfig.readSentryEnableLogs). So a recurring
// degradation showed up nowhere but the raw Vercel runtime log, where it took a
// human reading the daily brief to notice. Captured as an exception, it alerts.
//
// Routed through safeError rather than capturing the raw error directly, same
// as its siblings — a delivery error can carry a destination path or a signed
// token in its message, so the same redaction the pipeline's own logs get is
// applied before anything reaches Sentry.

import * as Sentry from '@sentry/nextjs'

import { safeError } from '@/lib/security/logging'

type CaptureNotificationExceptionInput = {
  error: unknown
  route: string
  event: string
  dispatchId?: string | null
  deliveryId?: string | null
}

/**
 * Captures a notification-delivery exception in Sentry with structured context
 * tags.
 *
 * Usage:
 *   captureNotificationException({
 *     error,
 *     route: 'processDueDeliveries',
 *     event: 'SHORT_LINK_MINT_FAILED',
 *     dispatchId: delivery.dispatch.id,
 *   })
 */
export function captureNotificationException(
  input: CaptureNotificationExceptionInput,
): void {
  const safe = safeError(input.error)
  const sanitized = new Error(safe.message)
  sanitized.name = safe.name

  Sentry.withScope((scope) => {
    scope.setTag('area', 'notifications')
    scope.setTag('notifications.event', input.event)
    scope.setTag('notifications.route', input.route)

    if (input.dispatchId) scope.setTag('notifications.dispatchId', input.dispatchId)
    if (input.deliveryId) scope.setTag('notifications.deliveryId', input.deliveryId)

    scope.setContext('notifications', {
      route: input.route,
      event: input.event,
      dispatchId: input.dispatchId ?? null,
      deliveryId: input.deliveryId ?? null,
    })

    Sentry.captureException(sanitized)
  })
}
