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

function cleanIana(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && isValidIanaTimeZone(s) ? s : null
}

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
  if (bookingTz) return { ok: true, timeZone: bookingTz, source: 'BOOKING_SNAPSHOT' }

  const holdTz = cleanIana(args.holdLocationTimeZone)
  if (holdTz) return { ok: true, timeZone: holdTz, source: 'HOLD_SNAPSHOT' }

  const locationTz = cleanIana(args.locationTimeZone)
  if (locationTz) return { ok: true, timeZone: locationTz, source: 'LOCATION' }

  const proTz = cleanIana(args.professionalTimeZone)
  if (proTz) return { ok: true, timeZone: proTz, source: 'PROFESSIONAL' }

  if (requireValid) {
    return {
      ok: false,
      error: 'Missing a valid timezone from booking, hold, location, or professional settings.',
    }
  }

  const fallbackRaw =
    typeof args.fallback === 'string' && args.fallback.trim()
      ? args.fallback.trim()
      : DEFAULT_TIME_ZONE

  return {
    ok: true,
    timeZone: sanitizeTimeZone(fallbackRaw, DEFAULT_TIME_ZONE),
    source: 'FALLBACK',
  }
}

export async function resolveApptTimeZone(args: TimeZoneTruthArgs): Promise<TimeZoneTruthResult> {
  const direct = resolveApptTimeZoneFromValues({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    holdLocationTimeZone: args.holdLocationTimeZone,
    locationTimeZone: args.locationTimeZone ?? args.location?.timeZone,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback,
    requireValid: false,
  })

  if (direct.ok && direct.source !== 'FALLBACK') return direct

  const locId = typeof args.locationId === 'string' ? args.locationId.trim() : ''
  const proId = typeof args.professionalId === 'string' ? args.professionalId.trim() : ''

  if (locId && proId) {
    const loc = await prisma.professionalLocation.findFirst({
      where: { id: locId, professionalId: proId },
      select: { timeZone: true },
    })

    const fetchedLocTz = cleanIana(loc?.timeZone)
    if (fetchedLocTz) {
      return { ok: true, timeZone: fetchedLocTz, source: 'LOCATION' }
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

export function resolveSchedulingTimeZoneFromValues(
  args: Omit<Parameters<typeof resolveApptTimeZoneFromValues>[0], 'requireValid'>
): TimeZoneTruthResult {
  return resolveApptTimeZoneFromValues({ ...args, requireValid: true })
}

export async function resolveSchedulingTimeZone(
  args: Omit<TimeZoneTruthArgs, 'requireValid'>
): Promise<TimeZoneTruthResult> {
  return resolveApptTimeZone({ ...args, requireValid: true })
}