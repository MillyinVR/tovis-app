// lib/observability/scheduledJobEvents.ts
//
// Structured Sentry capture for SCHEDULED-JOB failures — the cron handlers in
// app/api/internal/jobs/** whose top-level catch swallows the error and returns
// a 500 instead of rethrowing.
//
// Why this exists, and why only for *some* jobs: a cron has no user watching
// it. When a request-scoped handler fails the client sees a 500 and complains,
// so its console.error is supplementary. When a cron fails there is no client,
// and the only trace is a line in the Vercel runtime log — console output
// reaches Sentry only through consoleLoggingIntegration, gated on
// SENTRY_ENABLE_LOGS, deliberately OFF by default as a PII control
// (docs/reference/launch-readiness/risk-register.md). Same shape as the
// warnOnDivergentCronSecrets finding: the alarm was itself on the silent
// channel.
//
// This helper is deliberately NOT applied to every cron. Jobs that already have
// a second signal are left as console-only on purpose:
//   - notifications/process — the notifications/health probe measures the
//     delivery queue it drains and raises its own Sentry alert when deliveries
//     go stuck or overdue.
//   - stripe-* jobs, deposit-release, hold-cleanup, roll-forward, stale-sessions
//     — already call captureBookingException.
//   - the tidy-up sweeps (idempotency-retention, upload-sessions/cleanup,
//     nfc/tap-intent-cleanup, membership-comp-expiry) — nothing user-facing
//     degrades while they are down; membership-comp-expiry's own header says
//     entitlement reads already ignore an expired comp.
// The full triage — all 899 console.error/warn sites, three tiers, and what
// is deliberately left alone — is in OPEN-WORK.md.
//
// Routed through safeError rather than capturing the raw error directly, same
// as its siblings (captureNotificationException, captureLicensingException) —
// a sweep error can carry a storage path or a signed token in its message, so
// the same redaction the job's own logs get is applied before anything reaches
// Sentry.

import * as Sentry from '@sentry/nextjs'

import { safeError } from '@/lib/security/logging'

type CaptureScheduledJobExceptionInput = {
  error: unknown
  /** The cron path, e.g. '/api/internal/jobs/client-reminders'. */
  job: string
  /** Stable machine name for what failed, e.g. 'CLIENT_REMINDERS_SWEEP_ERROR'. */
  event: string
  /**
   * Sentry severity. Defaults to 'error'. Pass 'warning' for a degradation the
   * next scheduled run recovers from on its own.
   */
  level?: 'error' | 'warning'
}

/**
 * Captures a scheduled-job exception in Sentry with structured context tags.
 *
 * Usage:
 *   captureScheduledJobException({
 *     error,
 *     job: '/api/internal/jobs/client-reminders',
 *     event: 'CLIENT_REMINDERS_SWEEP_ERROR',
 *   })
 */
export function captureScheduledJobException(
  input: CaptureScheduledJobExceptionInput,
): void {
  const safe = safeError(input.error)
  const sanitized = new Error(safe.message)
  sanitized.name = safe.name

  Sentry.withScope((scope) => {
    scope.setLevel(input.level ?? 'error')
    scope.setTag('area', 'scheduled-job')
    scope.setTag('job.path', input.job)
    scope.setTag('job.event', input.event)

    scope.setContext('scheduledJob', {
      job: input.job,
      event: input.event,
      level: input.level ?? 'error',
    })

    Sentry.captureException(sanitized)
  })
}
