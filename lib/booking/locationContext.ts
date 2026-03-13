// lib/booking/locationContext.ts
import { ServiceLocationType } from '@prisma/client'
import {
  pickBookableLocation,
  type BookableLocation,
  type BookingDbClient,
} from '@/lib/booking/pickLocation'
import {
  resolveApptTimeZone,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import {
  ALLOWED_STEP_MINUTES,
  MAX_ADVANCE_NOTICE_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_DAYS_AHEAD,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { decimalToNumber } from '@/lib/booking/snapshots'
import { clampInt } from '@/lib/pick'
import { isRecord } from '@/lib/guards'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'

export type BookingLocationContext = {
  location: BookableLocation
  locationId: string
  locationType: ServiceLocationType
  timeZone: string
  timeZoneSource: TimeZoneTruthSource
  stepMinutes: number
  bufferMinutes: number
  advanceNoticeMinutes: number
  maxDaysAhead: number
  workingHours: unknown
  formattedAddress: string | null
  lat: number | undefined
  lng: number | undefined
}

export type SchedulingReadinessError =
  | 'LOCATION_NOT_FOUND'
  | 'TIMEZONE_REQUIRED'
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'MODE_NOT_SUPPORTED'
  | 'DURATION_REQUIRED'
  | 'PRICE_REQUIRED'
  | 'COORDINATES_REQUIRED'

type ResolveBookingLocationContextArgs = {
  tx?: BookingDbClient
  professionalId: string
  requestedLocationId?: string | null
  locationType: ServiceLocationType
  bookingLocationTimeZone?: string | null
  holdLocationTimeZone?: string | null
  professionalTimeZone?: string | null
  fallbackTimeZone?: string
  requireValidTimeZone?: boolean
  allowFallback?: boolean
}

type ResolveBookingLocationContextResult =
  | { ok: true; context: BookingLocationContext }
  | { ok: false; error: 'LOCATION_NOT_FOUND' | 'TIMEZONE_REQUIRED' }

export type OfferingSchedulingSnapshot = {
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null | undefined
  mobileDurationMinutes: number | null | undefined
  salonPriceStartingAt: unknown
  mobilePriceStartingAt: unknown
}

export type ResolveValidatedBookingContextArgs =
  ResolveBookingLocationContextArgs & {
    offering: OfferingSchedulingSnapshot
    requireCoordinates?: boolean
  }

export type ResolveValidatedBookingContextResult =
  | {
      ok: true
      context: BookingLocationContext
      durationMinutes: number
      priceStartingAt: number
    }
  | {
      ok: false
      error: SchedulingReadinessError
    }

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

  if (requested === ServiceLocationType.SALON) {
    return offersInSalon ? ServiceLocationType.SALON : null
  }

  if (requested === ServiceLocationType.MOBILE) {
    return offersMobile ? ServiceLocationType.MOBILE : null
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

function normalizeFormattedAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizePositiveMinutesOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return null

  const minutes = Math.trunc(parsed)
  if (minutes <= 0) return null

  return clampInt(minutes, 15, MAX_SLOT_DURATION_MINUTES)
}

function normalizePriceNumberOrNull(value: unknown): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof value.toString === 'function'
  ) {
    const parsed = Number(value.toString())
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function hasSchedulingWorkingHours(value: unknown): boolean {
  return isRecord(value)
}

function shouldAllowLocationFallback(args: {
  requestedLocationId: string | null
  allowFallback: boolean
}): boolean {
  const requestedLocationId =
    typeof args.requestedLocationId === 'string'
      ? args.requestedLocationId.trim()
      : ''

  if (requestedLocationId) {
    return false
  }

  return args.allowFallback
}

export function getModeDurationMinutesOrNull(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null | undefined
  mobileDurationMinutes: number | null | undefined
}): number | null {
  const raw =
    args.locationType === ServiceLocationType.MOBILE
      ? args.mobileDurationMinutes
      : args.salonDurationMinutes

  return normalizePositiveMinutesOrNull(raw)
}

/**
 * Backward-compatible export name used throughout the repo.
 * New booking-readiness code should prefer getModeDurationMinutesOrNull().
 */
export function pickModeDurationMinutes(args: {
  locationType: ServiceLocationType
  salonDurationMinutes: number | null | undefined
  mobileDurationMinutes: number | null | undefined
  fallbackDurationMinutes?: number
}): number {
  const strict = getModeDurationMinutesOrNull(args)
  if (strict != null) return strict

  const fallback = normalizePositiveMinutesOrNull(args.fallbackDurationMinutes)
  return fallback ?? 30
}

export function getModePriceStartingAtOrNull(args: {
  locationType: ServiceLocationType
  salonPriceStartingAt: unknown
  mobilePriceStartingAt: unknown
}): number | null {
  const raw =
    args.locationType === ServiceLocationType.MOBILE
      ? args.mobilePriceStartingAt
      : args.salonPriceStartingAt

  return normalizePriceNumberOrNull(raw)
}

export function offeringSupportsLocationType(args: {
  locationType: ServiceLocationType
  offersInSalon: boolean
  offersMobile: boolean
}): boolean {
  return args.locationType === ServiceLocationType.MOBILE
    ? args.offersMobile
    : args.offersInSalon
}

export function validateBookingLocationContext(args: {
  context: BookingLocationContext
  requireCoordinates?: boolean
}):
  | { ok: true }
  | {
      ok: false
      error:
        | 'TIMEZONE_REQUIRED'
        | 'WORKING_HOURS_REQUIRED'
        | 'WORKING_HOURS_INVALID'
        | 'COORDINATES_REQUIRED'
    } {
  const { context, requireCoordinates = false } = args

  if (!context.timeZone || !isValidIanaTimeZone(context.timeZone)) {
    return { ok: false, error: 'TIMEZONE_REQUIRED' }
  }

  if (context.workingHours == null) {
    return { ok: false, error: 'WORKING_HOURS_REQUIRED' }
  }

  if (!hasSchedulingWorkingHours(context.workingHours)) {
    return { ok: false, error: 'WORKING_HOURS_INVALID' }
  }

  if (
    requireCoordinates &&
    (typeof context.lat !== 'number' || typeof context.lng !== 'number')
  ) {
    return { ok: false, error: 'COORDINATES_REQUIRED' }
  }

  return { ok: true }
}

export function validateOfferingScheduling(args: {
  offering: OfferingSchedulingSnapshot
  locationType: ServiceLocationType
}):
  | { ok: true; durationMinutes: number; priceStartingAt: number }
  | {
      ok: false
      error: 'MODE_NOT_SUPPORTED' | 'DURATION_REQUIRED' | 'PRICE_REQUIRED'
    } {
  const { offering, locationType } = args

  if (
    !offeringSupportsLocationType({
      locationType,
      offersInSalon: Boolean(offering.offersInSalon),
      offersMobile: Boolean(offering.offersMobile),
    })
  ) {
    return { ok: false, error: 'MODE_NOT_SUPPORTED' }
  }

  const durationMinutes = getModeDurationMinutesOrNull({
    locationType,
    salonDurationMinutes: offering.salonDurationMinutes,
    mobileDurationMinutes: offering.mobileDurationMinutes,
  })

  if (durationMinutes == null) {
    return { ok: false, error: 'DURATION_REQUIRED' }
  }

  const priceStartingAt = getModePriceStartingAtOrNull({
    locationType,
    salonPriceStartingAt: offering.salonPriceStartingAt,
    mobilePriceStartingAt: offering.mobilePriceStartingAt,
  })

  if (priceStartingAt == null) {
    return { ok: false, error: 'PRICE_REQUIRED' }
  }

  return {
    ok: true,
    durationMinutes,
    priceStartingAt,
  }
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
    professionalTimeZone = null,
    fallbackTimeZone = 'UTC',
    requireValidTimeZone = true,
    allowFallback = true,
  } = args

  const effectiveAllowFallback = shouldAllowLocationFallback({
    requestedLocationId,
    allowFallback,
  })

  const location = await pickBookableLocation({
    tx,
    professionalId,
    requestedLocationId,
    locationType,
    allowFallback: effectiveAllowFallback,
  })

  if (!location) {
    return { ok: false, error: 'LOCATION_NOT_FOUND' }
  }

  const effectiveFallbackTimeZone =
    typeof professionalTimeZone === 'string' && professionalTimeZone.trim()
      ? professionalTimeZone.trim()
      : fallbackTimeZone

  const tzResult = await resolveApptTimeZone({
    bookingLocationTimeZone,
    holdLocationTimeZone,
    location: { id: location.id, timeZone: location.timeZone },
    professionalId,
    professionalTimeZone,
    fallback: effectiveFallbackTimeZone,
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
    rawResolvedTimeZone || effectiveFallbackTimeZone,
    effectiveFallbackTimeZone,
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
      timeZoneSource: tzResult.source,
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

export async function resolveValidatedBookingContext(
  args: ResolveValidatedBookingContextArgs,
): Promise<ResolveValidatedBookingContextResult> {
  const locationContextResult = await resolveBookingLocationContext(args)

  if (!locationContextResult.ok) {
    return locationContextResult
  }

  const contextValidation = validateBookingLocationContext({
    context: locationContextResult.context,
    requireCoordinates: args.requireCoordinates,
  })

  if (!contextValidation.ok) {
    return contextValidation
  }

  const offeringValidation = validateOfferingScheduling({
    offering: args.offering,
    locationType: args.locationType,
  })

  if (!offeringValidation.ok) {
    return offeringValidation
  }

  return {
    ok: true,
    context: locationContextResult.context,
    durationMinutes: offeringValidation.durationMinutes,
    priceStartingAt: offeringValidation.priceStartingAt,
  }
}