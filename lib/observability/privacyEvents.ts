// lib/observability/privacyEvents.ts
//
// Structured Sentry capture for privacy-domain job/route errors (account
// deletion, export). Mirrors captureAuthException in authEvents.ts and
// captureBookingException in bookingEvents.ts but tags by privacy context.
//
// Routed through safeError rather than capturing the raw error directly:
// this domain's failures are the ones most likely to carry a user's own
// contact details in the message (e.g. a constraint violation surfacing an
// email), so the same redaction the route's own logs already get is applied
// before anything reaches Sentry.

import * as Sentry from '@sentry/nextjs'

import { safeError } from '@/lib/security/logging'

type CapturePrivacyExceptionInput = {
  error: unknown
  route: string
  event: string
  userId?: string | null
  requestId?: string | null
}

/**
 * Captures a privacy-domain exception in Sentry with structured context tags.
 *
 * Usage:
 *   capturePrivacyException({
 *     error,
 *     route: 'GET /api/internal/jobs/account-deletion',
 *     event: 'ACCOUNT_DELETION_SWEEP_ERROR',
 *   })
 */
export function capturePrivacyException(
  input: CapturePrivacyExceptionInput,
): void {
  const safe = safeError(input.error)
  const sanitized = new Error(safe.message)
  sanitized.name = safe.name

  Sentry.withScope((scope) => {
    scope.setTag('area', 'privacy')
    scope.setTag('privacy.event', input.event)
    scope.setTag('privacy.route', input.route)

    if (input.userId) scope.setTag('privacy.userId', input.userId)
    if (input.requestId) scope.setTag('privacy.requestId', input.requestId)

    scope.setContext('privacy', {
      route: input.route,
      event: input.event,
      userId: input.userId ?? null,
      requestId: input.requestId ?? null,
    })

    Sentry.captureException(sanitized)
  })
}
