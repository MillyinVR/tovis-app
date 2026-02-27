// lib/booking/timeZoneTruth.ts
import { prisma } from '@/lib/prisma'
import { DEFAULT_TIME_ZONE, isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'

export type TimeZoneTruthArgs = {
  bookingLocationTimeZone?: unknown
  holdLocationTimeZone?: unknown

  location?: { id?: string | null; timeZone?: unknown } | null
  locationId?: string | null
  professionalId?: string | null

  professionalTimeZone?: unknown

  fallback?: string // default UTC
  requireValid?: boolean // default false
}

export type TimeZoneTruthResult =
  | { ok: true; timeZone: string; source: 'BOOKING' | 'HOLD' | 'LOCATION' | 'PRO' | 'FALLBACK' }
  | { ok: false; error: string }

function cleanIana(v: unknown) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s && isValidIanaTimeZone(s) ? s : null
}

export async function resolveApptTimeZone(args: TimeZoneTruthArgs): Promise<TimeZoneTruthResult> {
  const requireValid = Boolean(args.requireValid)

  const bookingTz = cleanIana(args.bookingLocationTimeZone)
  if (bookingTz) return { ok: true, timeZone: bookingTz, source: 'BOOKING' }

  const holdTz = cleanIana(args.holdLocationTimeZone)
  if (holdTz) return { ok: true, timeZone: holdTz, source: 'HOLD' }

  const providedLocTz = cleanIana(args.location?.timeZone)
  if (providedLocTz) return { ok: true, timeZone: providedLocTz, source: 'LOCATION' }

  const locId = typeof args.locationId === 'string' ? args.locationId.trim() : ''
  const proId = typeof args.professionalId === 'string' ? args.professionalId.trim() : ''

  // If we have ids, fetch the location tz (scoped to pro for safety)
  if (locId && proId) {
    const loc = await prisma.professionalLocation.findFirst({
      where: { id: locId, professionalId: proId },
      select: { timeZone: true },
    })
    const fetchedLocTz = cleanIana(loc?.timeZone)
    if (fetchedLocTz) return { ok: true, timeZone: fetchedLocTz, source: 'LOCATION' }
  }

  const proTz = cleanIana(args.professionalTimeZone)
  if (proTz) return { ok: true, timeZone: proTz, source: 'PRO' }

  // ✅ strict mode: no guessing, no fallback
  if (requireValid) {
    return {
      ok: false,
      error: 'Missing a valid timezone (booking/hold/location/pro). Please set a valid IANA timezone.',
    }
  }

  // ✅ non-strict: fallback allowed, but always safe + deterministic
  const fallbackRaw = typeof args.fallback === 'string' && args.fallback.trim() ? args.fallback.trim() : DEFAULT_TIME_ZONE
  const fallbackTz = sanitizeTimeZone(fallbackRaw, DEFAULT_TIME_ZONE)

  return { ok: true, timeZone: fallbackTz, source: 'FALLBACK' }
}
