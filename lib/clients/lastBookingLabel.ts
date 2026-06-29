// lib/clients/lastBookingLabel.ts
import { formatInTimeZone } from '@/lib/time'
import { resolveAppointmentDisplayTimeZone } from '@/lib/booking/appointmentDisplayTimeZone'

/**
 * Single source of truth for the "Last booking: …" subtitle on pro client-list
 * surfaces (the web `/pro/clients` page and the native directory API). Shows the
 * last appointment in the zone where it took place — a NY pro who served a client
 * in LA sees Pacific time — falling back to the pro's schedule zone, never the
 * server zone (UTC on Vercel). Returns the no-bookings sentinel when there is no
 * booking to date.
 */
export function formatLastBookingLabel(
  booking: { scheduledFor: Date; locationTimeZone: string | null } | null,
  fallbackTz: string,
): string {
  if (!booking) return 'No bookings yet'

  const tz = resolveAppointmentDisplayTimeZone(booking.locationTimeZone, fallbackTz)

  return `Last booking: ${formatInTimeZone(booking.scheduledFor, tz, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`
}
