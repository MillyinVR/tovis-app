// lib/booking/timeZoneTruth.ts
import { prisma } from '@/lib/prisma'
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

function cleanIana(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s && isValidIanaTimeZone(s) ? s : null
}

function cleanId(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s || null
}

function resolveLocationId(args: TimeZoneTruthArgs): string | null {
  return cleanId(args.location?.id) ?? cleanId(args.locationId)
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

  const bookingTz = cleanIana(args.bookingLocationTimeZone)
  if (bookingTz) {
    return { ok: true, timeZone: bookingTz, source: 'BOOKING_SNAPSHOT' }
  }

  const holdTz = cleanIana(args.holdLocationTimeZone)
  if (holdTz) {
    return { ok: true, timeZone: holdTz, source: 'HOLD_SNAPSHOT' }
  }

  const locationTz = cleanIana(args.locationTimeZone)
  if (locationTz) {
    return { ok: true, timeZone: locationTz, source: 'LOCATION' }
  }

  const professionalTz = cleanIana(args.professionalTimeZone)
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
 * Resolver that may look up the location timezone if only locationId/professionalId
 * are available. This keeps timezone precedence centralized for server-side scheduling.
 */
export async function resolveApptTimeZone(args: TimeZoneTruthArgs): Promise<TimeZoneTruthResult> {
  const direct = resolveApptTimeZoneFromValues({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    holdLocationTimeZone: args.holdLocationTimeZone,
    locationTimeZone: args.locationTimeZone ?? args.location?.timeZone,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback,
    requireValid: false,
  })

  if (direct.ok && direct.source !== 'FALLBACK') {
    return direct
  }

  const locationId = cleanId(args.locationId)
  const professionalId = cleanId(args.professionalId)

  if (locationId && professionalId) {
    const location = await prisma.professionalLocation.findFirst({
      where: { id: locationId, professionalId },
      select: { timeZone: true },
    })

    const fetchedLocationTz = cleanIana(location?.timeZone)
    if (fetchedLocationTz) {
      return { ok: true, timeZone: fetchedLocationTz, source: 'LOCATION' }
    }
  }

  return resolveApptTimeZoneFromValues({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    holdLocationTimeZone: args.holdLocationTimeZone,
    locationTimeZone: args.locationTimeZone ?? args.location?.timeZone,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback,
    requireValid: args.requireValid,
  })
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

/**
 * Strict async scheduling resolver that may fetch location timezone if needed.
 */
export async function resolveSchedulingTimeZone(
  args: Omit<TimeZoneTruthArgs, 'requireValid'>
): Promise<TimeZoneTruthResult> {
  return resolveApptTimeZone({ ...args, requireValid: true })
}

/**
 * Shared scheduling context for routes that need more than a timezone string.
 *
 * Server-side scheduling math should use `appointmentTimeZone` from this context.
 * UI may display other converted values, but should not invent scheduling truth.
 */
export async function resolveAppointmentSchedulingContext(
  args: TimeZoneTruthArgs
): Promise<AppointmentSchedulingContextResult> {
  const tzResult = await resolveApptTimeZone(args)
  if (!tzResult.ok) {
    return tzResult
  }

  const locationId = resolveLocationId(args)

  const locationTimeZone =
    tzResult.source === 'LOCATION'
      ? tzResult.timeZone
      : cleanIana(args.locationTimeZone ?? args.location?.timeZone)

  const businessTimeZone = cleanIana(args.professionalTimeZone)

  return {
    ok: true,
    context: {
      appointmentTimeZone: tzResult.timeZone,
      timeZoneSource: tzResult.source,
      locationId,
      locationTimeZone,
      businessTimeZone,
    },
  }
}