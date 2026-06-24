import { resolveApptTimeZoneFromValues } from '@/lib/time'

/**
 * The timezone an appointment should be DISPLAYED in: the booking's own
 * location snapshot (`Booking.locationTimeZone`) when present, else the
 * provided fallback (typically the pro's resolved schedule zone).
 *
 * Use this for rendering appointment/visit dates and times on pro surfaces so
 * the service shows in the zone where it actually takes place — e.g. a New
 * York pro traveling to LA sees the LA appointment in Pacific time, not their
 * home zone or the server zone (UTC on Vercel).
 *
 * Record timestamps that are not anchored to a location (note/review
 * `createdAt`, signatures, validity windows) should NOT use this — show those
 * in the pro's own schedule zone.
 */
export function resolveAppointmentDisplayTimeZone(
  bookingLocationTimeZone: unknown,
  fallbackTz: string,
): string {
  // We always pass a fallback and never set requireValid, so this resolves to
  // `ok: true`; narrow the union defensively and fall back to the schedule zone.
  const result = resolveApptTimeZoneFromValues({
    bookingLocationTimeZone,
    professionalTimeZone: fallbackTz,
    fallback: fallbackTz,
  })

  return result.ok ? result.timeZone : fallbackTz
}
