// lib/availability/core/placement.ts

import {
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'

import { pickString } from '@/app/api/_utils/pick'
import {
  normalizeLocationType,
  pickEffectiveLocationType,
  resolveValidatedBookingContext,
  type OfferingSchedulingSnapshot,
} from '@/lib/booking/locationContext'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'

export const LOCATION_SELECT = {
  id: true,
  type: true,
  isPrimary: true,
  isBookable: true,
  timeZone: true,
  workingHours: true,
  bufferMinutes: true,
  stepMinutes: true,
  advanceNoticeMinutes: true,
  maxDaysAhead: true,
  lat: true,
  lng: true,
  city: true,
  formattedAddress: true,
  createdAt: true,
} satisfies Prisma.ProfessionalLocationSelect

export type AvailabilityLocation = Prisma.ProfessionalLocationGetPayload<{
  select: typeof LOCATION_SELECT
}>

export type AvailabilityTimeZoneSource =
  | 'BOOKING_SNAPSHOT'
  | 'HOLD_SNAPSHOT'
  | 'LOCATION'
  | 'PROFESSIONAL'
  | 'FALLBACK'

export type AvailabilityPlacementErrorCode =
  | 'LOCATION_NOT_FOUND'
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'SALON_LOCATION_ADDRESS_REQUIRED'
  | 'TIMEZONE_REQUIRED'
  | 'WORKING_HOURS_REQUIRED'
  | 'WORKING_HOURS_INVALID'
  | 'MODE_NOT_SUPPORTED'
  | 'DURATION_REQUIRED'
  | 'PRICE_REQUIRED'
  | 'COORDINATES_REQUIRED'
  | 'NO_SCHEDULING_READY_LOCATION'

export type AvailabilityPlacementResult =
  | {
      ok: true
      location: AvailabilityLocation
      locationId: string
      locationType: ServiceLocationType
      timeZone: string
      timeZoneSource: AvailabilityTimeZoneSource
      workingHours: unknown
      stepMinutes: number
      leadTimeMinutes: number
      locationBufferMinutes: number
      maxAdvanceDays: number
      durationMinutes: number
      priceStartingAt: number
      formattedAddress: string | null
      lat: number | undefined
      lng: number | undefined
    }
  | {
      ok: false
      code: AvailabilityPlacementErrorCode
    }

type AvailabilityPlacementFailure = Extract<
  AvailabilityPlacementResult,
  { ok: false }
>

export type CachedPlacement = {
  locationId: string
  locationType: ServiceLocationType
  timeZone: string
  timeZoneSource: AvailabilityTimeZoneSource
  workingHours: unknown
  stepMinutes: number
  leadTimeMinutes: number
  locationBufferMinutes: number
  maxAdvanceDays: number
  durationMinutes: number
  priceStartingAt: number
  formattedAddress: string | null
  lat: number | undefined
  lng: number | undefined
  proBusinessName: string | null
  proAvatarUrl: string | null
  proLocation: string | null
  serviceName: string | null
  serviceCategory: string | null
  offeringId: string
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: string | null
  mobilePriceStartingAt: string | null
  locationCity: string | null
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseCachedPlacement(raw: unknown): CachedPlacement | null {
  if (!isRecord(raw)) return null

  const locationId = pickString(raw.locationId)
  const locationTypeRaw = pickString(raw.locationType)
  const timeZone = pickString(raw.timeZone)
  const offeringId = pickString(raw.offeringId)

  if (!locationId || !locationTypeRaw || !timeZone || !offeringId) {
    return null
  }

  const locationType = normalizeLocationType(locationTypeRaw)
  if (!locationType) return null

  const timeZoneSource = normalizeAvailabilityTimeZoneSource(raw.timeZoneSource)
  if (!timeZoneSource) return null

  if (typeof raw.stepMinutes !== 'number') return null
  if (typeof raw.durationMinutes !== 'number') return null
  if (typeof raw.leadTimeMinutes !== 'number') return null
  if (typeof raw.locationBufferMinutes !== 'number') return null
  if (typeof raw.maxAdvanceDays !== 'number') return null
  if (typeof raw.priceStartingAt !== 'number') return null
  if (typeof raw.offersInSalon !== 'boolean') return null
  if (typeof raw.offersMobile !== 'boolean') return null

  const lat =
    typeof raw.lat === 'number' && Number.isFinite(raw.lat)
      ? raw.lat
      : undefined

  const lng =
    typeof raw.lng === 'number' && Number.isFinite(raw.lng)
      ? raw.lng
      : undefined

  const salonDurationMinutes =
    typeof raw.salonDurationMinutes === 'number'
      ? raw.salonDurationMinutes
      : raw.salonDurationMinutes == null
        ? null
        : null

  const mobileDurationMinutes =
    typeof raw.mobileDurationMinutes === 'number'
      ? raw.mobileDurationMinutes
      : raw.mobileDurationMinutes == null
        ? null
        : null

  return {
    locationId,
    locationType,
    timeZone,
    timeZoneSource,
    workingHours: raw.workingHours,
    stepMinutes: raw.stepMinutes,
    leadTimeMinutes: raw.leadTimeMinutes,
    locationBufferMinutes: raw.locationBufferMinutes,
    maxAdvanceDays: raw.maxAdvanceDays,
    durationMinutes: raw.durationMinutes,
    priceStartingAt: raw.priceStartingAt,
    formattedAddress: normalizeAddress(raw.formattedAddress),
    lat,
    lng,
    proBusinessName: pickString(raw.proBusinessName) ?? null,
    proAvatarUrl: pickString(raw.proAvatarUrl) ?? null,
    proLocation: pickString(raw.proLocation) ?? null,
    serviceName: pickString(raw.serviceName) ?? null,
    serviceCategory: pickString(raw.serviceCategory) ?? null,
    offeringId,
    offersInSalon: raw.offersInSalon,
    offersMobile: raw.offersMobile,
    salonDurationMinutes,
    mobileDurationMinutes,
    salonPriceStartingAt: pickString(raw.salonPriceStartingAt) ?? null,
    mobilePriceStartingAt: pickString(raw.mobilePriceStartingAt) ?? null,
    locationCity: pickString(raw.locationCity) ?? null,
  }
}

export function buildOfferingSnapshot(offering: {
  offersInSalon: boolean
  offersMobile: boolean
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  salonPriceStartingAt: Prisma.Decimal | null
  mobilePriceStartingAt: Prisma.Decimal | null
}): OfferingSchedulingSnapshot {
  return {
    offersInSalon: Boolean(offering.offersInSalon),
    offersMobile: Boolean(offering.offersMobile),
    salonDurationMinutes: offering.salonDurationMinutes ?? null,
    mobileDurationMinutes: offering.mobileDurationMinutes ?? null,
    salonPriceStartingAt: offering.salonPriceStartingAt ?? null,
    mobilePriceStartingAt: offering.mobilePriceStartingAt ?? null,
  }
}

export function normalizeAvailabilityTimeZoneSource(
  value: unknown,
): AvailabilityTimeZoneSource | null {
  return value === 'BOOKING_SNAPSHOT' ||
    value === 'HOLD_SNAPSHOT' ||
    value === 'LOCATION' ||
    value === 'PROFESSIONAL' ||
    value === 'FALLBACK'
    ? value
    : null
}

export function resolvePlacementTimeZoneSource(args: {
  contextTimeZone: string
  contextTimeZoneSource?: unknown
  locationTimeZone?: unknown
  professionalTimeZone?: unknown
  fallbackTimeZone?: string
}): AvailabilityTimeZoneSource {
  const explicit = normalizeAvailabilityTimeZoneSource(
    args.contextTimeZoneSource,
  )
  if (explicit) return explicit

  const contextTimeZone = sanitizeTimeZone(args.contextTimeZone, 'UTC')

  const locationTimeZone =
    typeof args.locationTimeZone === 'string' &&
    isValidIanaTimeZone(args.locationTimeZone)
      ? sanitizeTimeZone(args.locationTimeZone, 'UTC')
      : null

  if (locationTimeZone && locationTimeZone === contextTimeZone) {
    return 'LOCATION'
  }

  const professionalTimeZone =
    typeof args.professionalTimeZone === 'string' &&
    isValidIanaTimeZone(args.professionalTimeZone)
      ? sanitizeTimeZone(args.professionalTimeZone, 'UTC')
      : null

  if (professionalTimeZone && professionalTimeZone === contextTimeZone) {
    return 'PROFESSIONAL'
  }

  const fallbackTimeZone = sanitizeTimeZone(
    args.fallbackTimeZone ?? 'UTC',
    'UTC',
  )

  if (fallbackTimeZone === contextTimeZone) {
    return 'FALLBACK'
  }

  return 'FALLBACK'
}

function locationTypeForLocation(
  location: Pick<AvailabilityLocation, 'type'>,
): ServiceLocationType {
  return location.type === ProfessionalLocationType.MOBILE_BASE
    ? ServiceLocationType.MOBILE
    : ServiceLocationType.SALON
}

function professionalLocationTypesForLocationType(
  locationType: ServiceLocationType,
): ProfessionalLocationType[] {
  return locationType === ServiceLocationType.MOBILE
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

/**
 * Enterprise-safe default:
 * - first-load placement prefers salon/suite when salon is supported
 * - mobile is only considered after salon/suite is unavailable or invalid
 */
function buildInitialPlacementOrder(
  offering: OfferingSchedulingSnapshot,
): ServiceLocationType[] {
  const order: ServiceLocationType[] = []

  if (offering.offersInSalon) {
    order.push(ServiceLocationType.SALON)
  }

  if (offering.offersMobile) {
    order.push(ServiceLocationType.MOBILE)
  }

  return order
}

async function loadPlacementCandidatesForLocationType(args: {
  professionalId: string
  locationType: ServiceLocationType
}): Promise<AvailabilityLocation[]> {
  return prisma.professionalLocation.findMany({
    where: {
      professionalId: args.professionalId,
      isBookable: true,
      type: {
        in: professionalLocationTypesForLocationType(args.locationType),
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: LOCATION_SELECT,
    take: 50,
  })
}

async function validateAvailabilityPlacement(args: {
  professionalId: string
  requestedLocationId: string | null
  locationType: ServiceLocationType
  offering: OfferingSchedulingSnapshot
  clientAddressId: string | null
  allowFallback: boolean
  professionalTimeZone: string | null
}): Promise<AvailabilityPlacementResult> {
  const fallbackTimeZone =
    typeof args.professionalTimeZone === 'string' &&
    isValidIanaTimeZone(args.professionalTimeZone)
      ? sanitizeTimeZone(args.professionalTimeZone, 'UTC')
      : 'UTC'

  const validated = await resolveValidatedBookingContext({
    professionalId: args.professionalId,
    requestedLocationId: args.requestedLocationId,
    locationType: args.locationType,
    professionalTimeZone: args.professionalTimeZone,
    fallbackTimeZone,
    requireValidTimeZone: true,
    allowFallback: args.allowFallback,
    requireCoordinates: false,
    offering: args.offering,
  })

  if (!validated.ok) {
    return {
      ok: false,
      code: validated.error,
    }
  }

  const context = validated.context
  const formattedAddress = normalizeAddress(context.formattedAddress)

  if (
    args.locationType === ServiceLocationType.MOBILE &&
    !args.clientAddressId
  ) {
    return {
      ok: false,
      code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
    }
  }

  if (
    args.locationType === ServiceLocationType.SALON &&
    !formattedAddress
  ) {
    return {
      ok: false,
      code: 'SALON_LOCATION_ADDRESS_REQUIRED',
    }
  }

  const timeZoneSource = resolvePlacementTimeZoneSource({
    contextTimeZone: context.timeZone,
    contextTimeZoneSource: context.timeZoneSource,
    locationTimeZone: context.location.timeZone,
    professionalTimeZone: args.professionalTimeZone,
    fallbackTimeZone,
  })

  return {
    ok: true,
    location: context.location,
    locationId: context.locationId,
    locationType: args.locationType,
    timeZone: context.timeZone,
    timeZoneSource,
    workingHours: context.workingHours,
    stepMinutes: context.stepMinutes,
    leadTimeMinutes: context.advanceNoticeMinutes,
    locationBufferMinutes: context.bufferMinutes,
    maxAdvanceDays: context.maxDaysAhead,
    durationMinutes: validated.durationMinutes,
    priceStartingAt: validated.priceStartingAt,
    formattedAddress,
    lat: context.lat,
    lng: context.lng,
  }
}

async function resolveInitialPlacementForLocationType(args: {
  professionalId: string
  locationType: ServiceLocationType
  offering: OfferingSchedulingSnapshot
  clientAddressId: string | null
  professionalTimeZone: string | null
}): Promise<AvailabilityPlacementResult> {
  const candidates = await loadPlacementCandidatesForLocationType({
    professionalId: args.professionalId,
    locationType: args.locationType,
  })

  if (!candidates.length) {
    return {
      ok: false,
      code: 'LOCATION_NOT_FOUND',
    }
  }

  let firstMeaningfulError: AvailabilityPlacementFailure | null = null

  for (const candidate of candidates) {
    const attempt = await validateAvailabilityPlacement({
      professionalId: args.professionalId,
      requestedLocationId: candidate.id,
      locationType: args.locationType,
      offering: args.offering,
      clientAddressId: args.clientAddressId,
      allowFallback: false,
      professionalTimeZone: args.professionalTimeZone,
    })

    if (attempt.ok) {
      return attempt
    }

    if (attempt.code !== 'LOCATION_NOT_FOUND' && firstMeaningfulError == null) {
      firstMeaningfulError = attempt
    }
  }

  return (
    firstMeaningfulError ?? {
      ok: false,
      code: 'NO_SCHEDULING_READY_LOCATION',
    }
  )
}

export async function resolveAvailabilityPlacement(args: {
  professionalId: string
  offering: OfferingSchedulingSnapshot
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  clientAddressId: string | null
  professionalTimeZone: string | null
}): Promise<AvailabilityPlacementResult> {
  const professionalId = args.professionalId.trim()
  const requestedLocationId = args.requestedLocationId?.trim() || null

  if (!professionalId) {
    return {
      ok: false,
      code: 'NO_SCHEDULING_READY_LOCATION',
    }
  }

  if (args.requestedLocationType) {
    const effectiveLocationType =
      pickEffectiveLocationType({
        requested: args.requestedLocationType,
        offersInSalon: args.offering.offersInSalon,
        offersMobile: args.offering.offersMobile,
      }) ?? null

    if (!effectiveLocationType) {
      return {
        ok: false,
        code: 'MODE_NOT_SUPPORTED',
      }
    }

    return validateAvailabilityPlacement({
      professionalId,
      requestedLocationId,
      locationType: effectiveLocationType,
      offering: args.offering,
      clientAddressId: args.clientAddressId,
      allowFallback: !requestedLocationId,
      professionalTimeZone: args.professionalTimeZone,
    })
  }

  if (requestedLocationId) {
    const requested = await prisma.professionalLocation.findFirst({
      where: {
        id: requestedLocationId,
        professionalId,
        isBookable: true,
      },
      select: LOCATION_SELECT,
    })

    if (!requested?.id) {
      return {
        ok: false,
        code: 'LOCATION_NOT_FOUND',
      }
    }

    const locationType = locationTypeForLocation(requested)

    return validateAvailabilityPlacement({
      professionalId,
      requestedLocationId,
      locationType,
      offering: args.offering,
      clientAddressId: args.clientAddressId,
      allowFallback: false,
      professionalTimeZone: args.professionalTimeZone,
    })
  }

  const placementOrder = buildInitialPlacementOrder(args.offering)

  if (!placementOrder.length) {
    return {
      ok: false,
      code: 'MODE_NOT_SUPPORTED',
    }
  }

  let firstMeaningfulError: AvailabilityPlacementFailure | null = null

  for (const locationType of placementOrder) {
    const attempt = await resolveInitialPlacementForLocationType({
      professionalId,
      locationType,
      offering: args.offering,
      clientAddressId: args.clientAddressId,
      professionalTimeZone: args.professionalTimeZone,
    })

    if (attempt.ok) {
      return attempt
    }

    if (attempt.code !== 'LOCATION_NOT_FOUND' && firstMeaningfulError == null) {
      firstMeaningfulError = attempt
    }
  }

  return (
    firstMeaningfulError ?? {
      ok: false,
      code: 'NO_SCHEDULING_READY_LOCATION',
    }
  )
}