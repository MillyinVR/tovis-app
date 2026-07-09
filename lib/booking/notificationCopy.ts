// lib/booking/notificationCopy.ts
//
// Shared, timezone-correct copy fragments for booking-lifecycle notifications
// (§12 NC1). All date/time formatting goes through @/lib/time in the booking's
// resolved timezone — never the server's zone.
import { formatInTimeZone, isValidIanaTimeZone } from '@/lib/time'

function safeZone(timeZone: string): string {
  return timeZone && isValidIanaTimeZone(timeZone) ? timeZone : 'UTC'
}

/** "Mon, Jun 30" in the given timezone. */
export function formatBookingDateLabel(date: Date, timeZone: string): string {
  return formatInTimeZone(
    date,
    safeZone(timeZone),
    { weekday: 'short', month: 'short', day: 'numeric' },
    'en-US',
  )
}

/** "2:00 PM" in the given timezone. */
export function formatBookingTimeLabel(date: Date, timeZone: string): string {
  return formatInTimeZone(
    date,
    safeZone(timeZone),
    { hour: 'numeric', minute: '2-digit' },
    'en-US',
  )
}

/** " on {date} at {time}", or "" when there is no scheduled instant. */
export function formatBookingWhenClause(
  scheduledFor: Date | null | undefined,
  timeZone: string,
): string {
  if (!scheduledFor) return ''
  return ` on ${formatBookingDateLabel(scheduledFor, timeZone)} at ${formatBookingTimeLabel(scheduledFor, timeZone)}`
}

/**
 * The unified client "appointment confirmed" copy (§12 NC1 #3+4) — one string
 * for every path (instant book, pro-created, request-accepted, offer-confirmed)
 * so they never drift. Degrades gracefully when the pro name, service, or time
 * is missing.
 */
export function buildBookingConfirmedClientCopy(args: {
  proName: string | null | undefined
  serviceName: string | null | undefined
  scheduledFor: Date | null | undefined
  timeZone: string
}): { title: string; body: string } {
  const proName = args.proName?.trim() || null
  const serviceName = args.serviceName?.trim() || null
  const withPro = proName ? ` with ${proName}` : ''
  const forService = serviceName ? ` for ${serviceName}` : ''
  const whenClause = formatBookingWhenClause(args.scheduledFor, args.timeZone)

  return {
    title: 'Appointment confirmed',
    body: `You're booked${withPro}${forService}${whenClause}.`,
  }
}
