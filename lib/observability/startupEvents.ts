// lib/observability/startupEvents.ts
//
// Structured Sentry capture for production STARTUP misconfigurations — the
// conditions startupEnvValidation.ts detects but deliberately does not
// fail-closed on, because the server still boots.
//
// Why this exists: those conditions are exactly the ones whose own comments say
// the resulting failure is silent ("every scheduled job will 401",
// "migrate deploy will hang"), and until now the ONLY alarm for them was a
// console.error. Console output reaches Sentry only through
// consoleLoggingIntegration, which is gated on SENTRY_ENABLE_LOGS — deliberately
// OFF by default as a PII control (docs/reference/launch-readiness/
// risk-register.md). So the alarm for a silent failure was itself silent.
//
// Captured as a MESSAGE, not an exception: nothing threw. There is no error
// object and no stack worth showing — the finding IS the message. Mirrors the
// Sentry.captureMessage family in bookingEvents.ts (captureLifecycleDrift,
// captureOverlapBackstopFired, …) rather than inventing a second style.
//
// Nothing here is caller-supplied: every message is a fixed string literal in
// startupEnvValidation.ts, and no env VALUE is ever passed in — only the fact
// that one is shaped wrong. So there is nothing to redact, and unlike its
// sibling helpers this one takes no `error` to route through safeError().

import * as Sentry from '@sentry/nextjs'

type CaptureStartupMisconfigInput = {
  /** Stable machine name, matching the console line's `event` field. */
  event: string
  /** Fixed, non-caller-supplied description of the misconfiguration. */
  message: string
  level: 'error' | 'warning'
}

/**
 * Captures a production startup misconfiguration in Sentry with structured
 * context tags.
 *
 * Usage:
 *   captureStartupMisconfig({
 *     event: 'divergent_cron_secrets',
 *     message: 'INTERNAL_JOB_SECRET and CRON_SECRET are both set but differ…',
 *     level: 'error',
 *   })
 */
export function captureStartupMisconfig(
  input: CaptureStartupMisconfigInput,
): void {
  Sentry.withScope((scope) => {
    scope.setLevel(input.level)
    scope.setTag('area', 'startup')
    scope.setTag('startup.event', input.event)

    scope.setContext('startup', {
      event: input.event,
      level: input.level,
      message: input.message,
    })

    Sentry.captureMessage(`startup misconfiguration: ${input.event}`)
  })
}
