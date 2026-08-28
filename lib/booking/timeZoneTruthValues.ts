// lib/booking/timeZoneTruthValues.ts
//
// The CLIENT-SAFE half of timezone truth: the pure precedence rules and the
// types they speak in. No database, no `@/lib/prisma`, nothing server-only —
// so this module is safe to pull into a browser bundle.
//
// Its server-only sibling `@/lib/booking/timeZoneTruth` adds the resolvers that
// may fall back to a `ProfessionalLocation` lookup, and re-exports everything
// here so server call sites can keep importing from one place.
//
// The split is load-bearing, not cosmetic: `@/lib/time` re-exports the pure
// resolvers below, and `@/lib/time` is what the house rules tell every UI file
// to import. When the pure resolvers lived in the same module as the Prisma
// query, that barrel dragged `new PrismaClient()` and the whole generated
// client into 124 client components' bundles.
import { DEFAULT_TIME_ZONE, isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'

export type TimeZoneTruthSource =
  | 'BOOKING_SNAPSHOT'
  | 'HOLD_SNAPSHOT'
  | 'LOCATION'
  | 'PROFESSIONAL'
  | 'FALLBACK'

export type TimeZoneTruthArgs = {
  bookingLocationTimeZone?: unknown
  holdLocationTimeZone?: unknown

  locationTimeZone?: unknown
  location?: { id?: string | null; timeZone?: unknown } | null
  locationId?: string | null

  professionalId?: string | null
  professionalTimeZone?: unknown

  fallback?: string
  requireValid?: boolean
}

export type TimeZoneTruthResult =
  | { ok: true; timeZone: string; source: TimeZoneTruthSource }
  | { ok: false; error: string }

export type AppointmentSchedulingContext = {
  appointmentTimeZone: string
  timeZoneSource: TimeZoneTruthSource
  locationId: string | null
  locationTimeZone: string | null
  businessTimeZone: string | null
}

export type AppointmentSchedulingContextResult =
  | { ok: true; context: AppointmentSchedulingContext }
  | { ok: false; error: string }

/** A valid IANA zone, or null. Both helpers here carry domain-specific names on
 *  purpose: generic id/string cleaners already exist privately elsewhere in this
 *  repo returning an empty string rather than null, and two same-named helpers
 *  that disagree about that is the bug `check:no-private-lib-fork` exists for. */
export function cleanIanaTimeZone(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s && isValidIanaTimeZone(s) ? s : null
}

/** A trimmed non-empty id, or null — the ids timezone truth may look up by. */
export function cleanTimeZoneLookupId(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s || null
}

export function resolveLocationId(args: TimeZoneTruthArgs): string | null {
  return cleanTimeZoneLookupId(args.location?.id) ?? cleanTimeZoneLookupId(args.locationId)
}

function normalizeFallback(fallback: unknown): string {
  const raw = typeof fallback === 'string' && fallback.trim() ? fallback.trim() : DEFAULT_TIME_ZONE
  return sanitizeTimeZone(raw, DEFAULT_TIME_ZONE)
}

/**
 * Pure resolver from already-available values.
 *
 * Precedence:
 * 1. booking snapshot timezone
 * 2. hold snapshot timezone
 * 3. location timezone
 * 4. professional/business timezone
 * 5. fallback (unless requireValid=true)
 */
export function resolveApptTimeZoneFromValues(args: {
  bookingLocationTimeZone?: unknown
  holdLocationTimeZone?: unknown
  locationTimeZone?: unknown
  professionalTimeZone?: unknown
  fallback?: string
  requireValid?: boolean
}): TimeZoneTruthResult {
  const requireValid = Boolean(args.requireValid)

  const bookingTz = cleanIanaTimeZone(args.bookingLocationTimeZone)
  if (bookingTz) {
    return { ok: true, timeZone: bookingTz, source: 'BOOKING_SNAPSHOT' }
  }

  const holdTz = cleanIanaTimeZone(args.holdLocationTimeZone)
  if (holdTz) {
    return { ok: true, timeZone: holdTz, source: 'HOLD_SNAPSHOT' }
  }

  const locationTz = cleanIanaTimeZone(args.locationTimeZone)
  if (locationTz) {
    return { ok: true, timeZone: locationTz, source: 'LOCATION' }
  }

  const professionalTz = cleanIanaTimeZone(args.professionalTimeZone)
  if (professionalTz) {
    return { ok: true, timeZone: professionalTz, source: 'PROFESSIONAL' }
  }

  if (requireValid) {
    return {
      ok: false,
      error: 'Missing a valid timezone from booking, hold, location, or professional settings.',
    }
  }

  return {
    ok: true,
    timeZone: normalizeFallback(args.fallback),
    source: 'FALLBACK',
  }
}

/**
 * Strict scheduling resolver: same precedence as appointment timezone truth,
 * but refuses to silently fall back when no valid timezone is available.
 */
export function resolveSchedulingTimeZoneFromValues(
  args: Omit<Parameters<typeof resolveApptTimeZoneFromValues>[0], 'requireValid'>
): TimeZoneTruthResult {
  return resolveApptTimeZoneFromValues({ ...args, requireValid: true })
}
