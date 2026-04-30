// lib/observability/bookingEvents.ts
//
// Structured Sentry capture for booking route errors.
// Mirrors captureAuthException in authEvents.ts but tags by booking context.
//
import * as Sentry from '@sentry/nextjs'
import {
  registerLifecycleDriftSink,
  type LifecycleDriftEvent,
} from '@/lib/booking/lifecycleContract'

type CaptureBookingExceptionInput = {
  error: unknown
  route: string
  bookingId?: string | null
  professionalId?: string | null
  clientId?: string | null
  holdId?: string | null
  event?: string | null
}

/**
 * Captures a booking-domain exception in Sentry with structured context tags.
 *
 * Usage:
 *   captureBookingException(error, {
 *     bookingId: args.bookingId,
 *     professionalId: args.professionalId,
 *     clientId: args.clientId,
 *     route: 'POST /api/bookings/finalize',
 *   })
 */
export function captureBookingException(
  input: CaptureBookingExceptionInput,
): void {
  const err =
    input.error instanceof Error
      ? input.error
      : new Error(String(input.error))

  Sentry.withScope((scope) => {
    scope.setTag('area', 'booking')
    scope.setTag('booking.route', input.route)

    if (input.event) scope.setTag('booking.event', input.event)
    if (input.bookingId) scope.setTag('booking.id', input.bookingId)
    if (input.professionalId) scope.setTag('booking.professionalId', input.professionalId)
    if (input.clientId) scope.setTag('booking.clientId', input.clientId)
    if (input.holdId) scope.setTag('booking.holdId', input.holdId)

    scope.setContext('booking', {
      route: input.route,
      event: input.event ?? null,
      bookingId: input.bookingId ?? null,
      professionalId: input.professionalId ?? null,
      clientId: input.clientId ?? null,
      holdId: input.holdId ?? null,
    })

    Sentry.captureException(err)
  })
}

/**
 * Captures a lifecycle contract drift event in Sentry as a structured warning.
 *
 * "Drift" means a SessionStep or BookingStatus transition was performed that
 * the lifecycle contract does not permit. Today we report it; under
 * `LIFECYCLE_STRICT_MODE=true` the contract throws upstream and this sink is
 * still called for visibility.
 */
export function captureLifecycleDrift(event: LifecycleDriftEvent): void {
  Sentry.withScope((scope) => {
    scope.setLevel('warning')
    scope.setTag('area', 'booking')
    scope.setTag('booking.event', 'lifecycle_drift')
    scope.setTag('booking.lifecycle.kind', event.kind)
    scope.setTag('booking.lifecycle.actor', event.actor)
    scope.setTag('booking.lifecycle.from', String(event.from))
    scope.setTag('booking.lifecycle.to', String(event.to))
    scope.setTag('booking.route', event.route)

    if (event.bookingId) scope.setTag('booking.id', event.bookingId)
    if (event.professionalId)
      scope.setTag('booking.professionalId', event.professionalId)

    scope.setContext('lifecycle_drift', {
      kind: event.kind,
      from: event.from,
      to: event.to,
      actor: event.actor,
      route: event.route,
      reason: event.reason,
      bookingId: event.bookingId ?? null,
      professionalId: event.professionalId ?? null,
    })

    Sentry.captureMessage(
      `Lifecycle drift: ${event.kind} ${event.from} → ${event.to} by ${event.actor} (${event.route})`,
      'warning',
    )
  })

  // Structured log line so it shows up in Vercel logs even without Sentry.
  console.warn(
    JSON.stringify({
      level: 'warn',
      app: 'tovis',
      namespace: 'booking',
      event: 'lifecycle_drift',
      kind: event.kind,
      from: event.from,
      to: event.to,
      actor: event.actor,
      route: event.route,
      bookingId: event.bookingId ?? null,
      professionalId: event.professionalId ?? null,
      reason: event.reason,
    }),
  )
}

// Register the Sentry sink once at module load. The lifecycleContract module
// keeps a registry of sinks and emits to all of them on drift.
let driftSinkRegistered = false
if (!driftSinkRegistered) {
  registerLifecycleDriftSink(captureLifecycleDrift)
  driftSinkRegistered = true
}
