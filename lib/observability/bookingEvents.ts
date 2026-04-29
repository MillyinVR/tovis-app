// lib/observability/bookingEvents.ts
//
// Structured Sentry capture for booking route errors.
// Mirrors captureAuthException in authEvents.ts but tags by booking context.
//
import * as Sentry from '@sentry/nextjs'

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
