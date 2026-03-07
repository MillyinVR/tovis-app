// lib/booking/locationContext.ts
import { ServiceLocationType } from '@prisma/client'
import {
  pickBookableLocation,
  type BookableLocation,
  type BookingDbClient,
} from '@/lib/booking/pickLocation'
import { resolveApptTimeZone } from '@/lib/booking/timeZoneTruth'
import {
  ALLOWED_STEP_MINUTES,
  DEFAULT_DURATION_MINUTES,
  MAX_ADVANCE_NOTICE_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_DAYS_AHEAD,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { decimalToNumber } from '@/lib/booking/snapshots'
import { clampInt } from '@/lib/pick'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'

export type BookingLocationContext = {
  location: BookableLocation
  locationId: string
  locationType: ServiceLocationType
  timeZone: string
  stepMinutes: number
  bufferMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  workingHours: unknown
  formattedAddress: string | null
  lat: number | undefined
  lng: number | undefined
}

type ResolveBookingLocationContextArgs = {
  tx?: BookingDbClient
  professionalId: string
  requestedLocationId?: string | null
  locationType: ServiceLocationType
  bookingLocationTimeZone?: string | null
  holdLocationTimeZone?: string | null
  fallbackTimeZone?: string
  requireValidTimeZone?: boolean
  allowFallback?: boolean
}

type ResolveBookingLocationContextResult =
  | { ok: true; context: BookingLocationContext }
  | { ok: false; error: 'LOCATION_NOT_FOUND' | 'TIMEZONE_REQUIRED' }

const ALLOWED_STEP_SET = new Set<number>(ALLOWED_STEP_MINUTES)

export function normalizeLocationType(
  value: unknown,
): ServiceLocationType | null {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (normalized === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (normalized === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE

  return null
}

export function pickEffectiveLocationType(args: {
  requested: ServiceLocationType | null
  offersInSalon: boolean
  offersMobile: boolean
}): ServiceLocationType | null {
  const { requested, offersInSalon, offersMobile } = args

  if (requested === ServiceLocationType.SALON && offersInSalon) {
    return ServiceLocationType.SALON
  }

  if (requested === ServiceLocationType.MOBILE && offersMobile) {
    return ServiceLocationType.MOBILE
  }

  if (offersInSalon) return ServiceLocationType.SALON
  if (offersMobile) return ServiceLocationType.MOBILE

  return null
}

export function normalizeStepMinutes(input: unknown, fallback: number): number {
  const parsed = typeof input === 'number' ? input : Number(input)
  const raw = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback

  if (ALLOWED_STEP_SET.has(raw)) return raw

  if (raw <= 5) return 5
  if (raw <= 10) return 10
  if (raw <= 15) return 15
  if (raw <= 20) return 20
  if (raw <= 30) return 30
  return 60
}

export function pickModeDurationMinutes(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null | undefined
  mobileDurationMinutes: number | null | undefined
  fallbackDurationMinutes?: number
}): number {
  const {
    locationType,
    salonDurationMinutes,
    mobileDurationMinutes,
    fallbackDurationMinutes = DEFAULT_DURATION_MINUTES,
  } = args

  const raw =
    locationType === ServiceLocationType.MOBILE
      ? mobileDurationMinutes
      : salonDurationMinutes

  const parsed = Number(raw ?? fallbackDurationMinutes)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return clampInt(fallbackDurationMinutes, 15, MAX_SLOT_DURATION_MINUTES)
  }

  return clampInt(parsed, 15, MAX_SLOT_DURATION_MINUTES)
}

function normalizeFormattedAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function resolveBookingLocationContext(
  args: ResolveBookingLocationContextArgs,
): Promise<ResolveBookingLocationContextResult> {
  const {
    tx,
    professionalId,
    requestedLocationId = null,
    locationType,
    bookingLocationTimeZone = null,
    holdLocationTimeZone = null,
    fallbackTimeZone = 'UTC',
    requireValidTimeZone = true,
    allowFallback = true,
  } = args

  const location = await pickBookableLocation({
    tx,
    professionalId,
    requestedLocationId,
    locationType,
    allowFallback,
  })

  if (!location) {
    return { ok: false, error: 'LOCATION_NOT_FOUND' }
  }

  const tzResult = await resolveApptTimeZone({
    bookingLocationTimeZone,
    holdLocationTimeZone,
    location: { id: location.id, timeZone: location.timeZone },
    professionalId,
    fallback: fallbackTimeZone,
    requireValid: requireValidTimeZone,
  })

  if (!tzResult.ok) {
    return { ok: false, error: 'TIMEZONE_REQUIRED' }
  }

  const rawResolvedTimeZone =
    typeof tzResult.timeZone === 'string' ? tzResult.timeZone.trim() : ''

  if (requireValidTimeZone && !isValidIanaTimeZone(rawResolvedTimeZone)) {
    return { ok: false, error: 'TIMEZONE_REQUIRED' }
  }

  const timeZone = sanitizeTimeZone(
    rawResolvedTimeZone || fallbackTimeZone,
    fallbackTimeZone,
  )

  if (!isValidIanaTimeZone(timeZone)) {
    return { ok: false, error: 'TIMEZONE_REQUIRED' }
  }

  return {
    ok: true,
    context: {
      location,
      locationId: location.id,
      locationType,
      timeZone,
      stepMinutes: normalizeStepMinutes(location.stepMinutes, 15),
      bufferMinutes: clampInt(
        Number(location.bufferMinutes ?? 0),
        0,
        MAX_BUFFER_MINUTES,
      ),
      advanceNoticeMinutes: clampInt(
        Number(location.advanceNoticeMinutes ?? 15),
        0,
        MAX_ADVANCE_NOTICE_MINUTES,
      ),
      maxDaysAhead: clampInt(
        Number(location.maxDaysAhead ?? 365),
        1,
        MAX_DAYS_AHEAD,
      ),
      workingHours: location.workingHours,
      formattedAddress: normalizeFormattedAddress(location.formattedAddress),
      lat: decimalToNumber(location.lat),
      lng: decimalToNumber(location.lng),
    },
  }
}