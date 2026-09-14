// lib/observability/consultAlerts.ts
//
// The consult's one PAGING sink.
//
// Kept out of `aiConsultEvents.ts` for the reason `sweepObservation.ts` spells
// out: that module is routine measurement, read after the fact, and suites mock
// it freely. This one reaches a human. Mixing them means either a metrics line
// that pages or a page that a metrics mock silently swallows.
//
// 🔴 Sentry is the transport because it is the one that currently WORKS. The
// Sentry→Slack integration has delivered nothing since 2026-07-22 (it is
// Disabled, while the rule still reports its Slack action as active), but email
// alerting is live and fires on first-seen issues. A new issue fingerprint here
// therefore becomes an email; a repeat of the same unhealthy kind groups under
// the existing issue instead of mailing every morning.

import * as Sentry from '@sentry/nextjs'

export type ConsultProviderHealthAlertEvent = {
  kind: string
  windowHours: number
  totalCalls: number
  failedCalls: number
  failureRate: number
  topFailureChecks: { check: string; count: number }[]
}

/**
 * Raise ONE issue per unhealthy call kind.
 *
 * Reported as a `warning`, not an `error`: the pipeline is degraded, not down,
 * and a consult that fails still fails safely (the client sees a retryable
 * state, never a wrong plan). The message names the kind and the rate so the
 * email subject alone says what is wrong.
 *
 * The fingerprint is the kind, deliberately — one ongoing issue per broken
 * call, reopened rather than re-mailed daily, so a week of a 44% failure rate
 * is one thread and not seven.
 */
export function captureConsultProviderHealthAlert(
  event: ConsultProviderHealthAlertEvent,
): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning')
    scope.setTag('area', 'consult')
    scope.setTag('consult.event', 'provider_health')
    scope.setTag('consult.provider.kind', event.kind)
    scope.setFingerprint(['consult-provider-health', event.kind])
    scope.setContext('consultProviderHealth', {
      kind: event.kind,
      windowHours: event.windowHours,
      totalCalls: event.totalCalls,
      failedCalls: event.failedCalls,
      failureRatePercent: Math.round(event.failureRate * 1000) / 10,
      topFailureChecks: event.topFailureChecks
        .map((entry) => `${entry.check}×${entry.count}`)
        .join(', '),
    })
    Sentry.captureMessage(
      `Consult provider ${event.kind} is failing ${Math.round(
        event.failureRate * 100,
      )}% of calls (${event.failedCalls}/${event.totalCalls} in ${event.windowHours}h)`,
    )
  })
}
