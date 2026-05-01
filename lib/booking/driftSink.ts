// lib/booking/driftSink.ts
//
// Wires the Sentry / structured-log drift sink into the lifecycle contract.
// Call initLifecycleDriftSink() once at server startup (instrumentation.ts).
//
import * as Sentry from '@sentry/nextjs'
import { registerLifecycleDriftSink, type LifecycleDriftEvent } from './lifecycleContract'

let initialized = false

export function initLifecycleDriftSink(): void {
  if (initialized) return
  initialized = true

  registerLifecycleDriftSink((event: LifecycleDriftEvent) => {
    // Structured log for observability pipelines
    console.warn('[lifecycle-drift]', JSON.stringify({
      kind: event.kind,
      from: event.from,
      to: event.to,
      actor: event.actor,
      route: event.route,
      bookingId: event.bookingId ?? null,
      professionalId: event.professionalId ?? null,
      reason: event.reason,
    }))

    // Sentry breadcrumb + issue capture
    Sentry.withScope((scope) => {
      scope.setTag('lifecycle.kind', event.kind)
      scope.setTag('lifecycle.from', String(event.from))
      scope.setTag('lifecycle.to', String(event.to))
      scope.setTag('lifecycle.actor', event.actor)
      scope.setTag('lifecycle.route', event.route)
      if (event.bookingId) scope.setTag('bookingId', event.bookingId)
      if (event.professionalId) scope.setTag('professionalId', event.professionalId)

      scope.setLevel('warning')
      Sentry.captureMessage(`Lifecycle drift: ${event.kind} ${event.from} → ${event.to}`, 'warning')
    })
  })
}
