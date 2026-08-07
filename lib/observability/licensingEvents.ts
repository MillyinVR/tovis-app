// lib/observability/licensingEvents.ts
//
// Structured Sentry capture for licensing-domain job/route errors (verification
// document retention purge, license-expiry notification sweep). Mirrors
// capturePrivacyException in privacyEvents.ts and captureAuthException in
// authEvents.ts but tags by licensing context.
//
// Routed through safeError rather than capturing the raw error directly, same
// as its siblings — a storage-deletion failure can carry a signed URL or path
// in its message, so the same redaction the route's own logs already get is
// applied before anything reaches Sentry.

import * as Sentry from '@sentry/nextjs'

import { safeError } from '@/lib/security/logging'

type CaptureLicensingExceptionInput = {
  error: unknown
  route: string
  event: string
  professionalId?: string | null
  documentId?: string | null
}

/**
 * Captures a licensing-domain exception in Sentry with structured context tags.
 *
 * Usage:
 *   captureLicensingException({
 *     error,
 *     route: 'GET /api/internal/jobs/license-doc-retention',
 *     event: 'LICENSE_DOC_RETENTION_SWEEP_ERROR',
 *   })
 */
export function captureLicensingException(
  input: CaptureLicensingExceptionInput,
): void {
  const safe = safeError(input.error)
  const sanitized = new Error(safe.message)
  sanitized.name = safe.name

  Sentry.withScope((scope) => {
    scope.setTag('area', 'licensing')
    scope.setTag('licensing.event', input.event)
    scope.setTag('licensing.route', input.route)

    if (input.professionalId) scope.setTag('licensing.professionalId', input.professionalId)
    if (input.documentId) scope.setTag('licensing.documentId', input.documentId)

    scope.setContext('licensing', {
      route: input.route,
      event: input.event,
      professionalId: input.professionalId ?? null,
      documentId: input.documentId ?? null,
    })

    Sentry.captureException(sanitized)
  })
}
