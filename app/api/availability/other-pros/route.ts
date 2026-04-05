// app/api/availability/other-pros/route.ts
import { createHash } from 'node:crypto'

import { Prisma, ProfessionalLocationType, ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { pickString } from '@/app/api/_utils/pick'
import { decimalToNumber } from '@/lib/booking/snapshots'
import {
  normalizeLocationType,
  pickEffectiveLocationType,
  resolveValidatedBookingContext,
  type OfferingSchedulingSnapshot,
  type SchedulingReadinessError,
} from '@/lib/booking/locationContext'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import {
  isValidIanaTimeZone,
  sanitizeTimeZone,
} from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

const TTL_OTHER_PROS_SECONDS = 600
const TTL_PLACEMENT_SECONDS = 600

const LOCATION_SELECT = {
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

type AvailabilityLocation = Prisma.ProfessionalLocationGetPayload<{
  select: typeof LOCATION_SELECT
}>

type OtherProRow = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  offeringId: string
  timeZone: string
  locationId: string
  distanceMiles: number
}

type OtherProsRequestPayload = {
  professionalId: string
  serviceId: string
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  effectiveLocationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  viewer: {
    lat: number
    lng: number
    radiusMiles: number
    placeId: string | null
  } | null
  limit: number
}

type AvailabilityPlacementErrorCode =
  | SchedulingReadinessError
  | 'CLIENT_SERVICE_ADDRESS_REQUIRED'
  | 'SALON_LOCATION_ADDRESS_REQUIRED'
  | 'NO_SCHEDULING_READY_LOCATION'

type AvailabilityPlacementResult =
  | {
      ok: true
      location: AvailabilityLocation
      locationId: string
      locationType: ServiceLocationType
      timeZone: string
      lat: number | undefined
      lng: number | undefined
    }
  | {
      ok: false
      code: AvailabilityPlacementErrorCode
      error: string
    }

type CachedPlacement = {
  locationId: string
  locationType: ServiceLocationType
  timeZone: string
  lat: number | undefined
  lng: number | undefined
}

const redis = getRedis()

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseFloatParam(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!redis) return null

  try {
    const raw = await redis.get<string>(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!redis) return

  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds })
  } catch {
    // fail-open
  }
}

function buildPlacementCacheKey(args: {
  professionalId: string
  serviceId: string
  locationType: string | null
  locationId: string | null
  clientAddressId: string | null
}): string {
  return [
    'avail:other-pros:placement:v2',
    args.professionalId,
    args.serviceId,
    args.locationType ?? 'AUTO',
    args.locationId ?? 'AUTO',
    args.clientAddressId ?? 'none',
  ].join(':')
}

function parseCachedPlacement(raw: unknown): CachedPlacement | null {
  if (!isRecord(raw)) return null

  const locationId =
    typeof raw.locationId === 'string' && raw.locationId.trim()
      ? raw.locationId.trim()
      : null
  const locationType =
    raw.locationType === ServiceLocationType.SALON ||
    raw.locationType === ServiceLocationType.MOBILE
      ? raw.locationType
      : null
  const timeZone =
    typeof raw.timeZone === 'string' && raw.timeZone.trim()
      ? sanitizeTimeZone(raw.timeZone, 'UTC')
      : null

  if (!locationId || !locationType || !timeZone) return null

  const lat =
    typeof raw.lat === 'number' && Number.isFinite(raw.lat)
      ? raw.lat
      : undefined
  const lng =
    typeof raw.lng === 'number' && Number.isFinite(raw.lng)
      ? raw.lng
      : undefined

  return {
    locationId,
    locationType,
    timeZone,
    lat,
    lng,
  }
}

function allowedProfessionalTypes(
  locationType: ServiceLocationType,
): ProfessionalLocationType[] {
  return locationType === ServiceLocationType.MOBILE
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function locationTypeForLocation(
  location: Pick<AvailabilityLocation, 'type'>,
): ServiceLocationType {
  return location.type === ProfessionalLocationType.MOBILE_BASE
    ? ServiceLocationType.MOBILE
    : ServiceLocationType.SALON
}

function buildOfferingSnapshot(offering: {
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

function mapPlacementError(code: AvailabilityPlacementErrorCode): string {
  switch (code) {
    case 'CLIENT_SERVICE_ADDRESS_REQUIRED':
      return 'Select a saved service address before viewing mobile availability.'
    case 'SALON_LOCATION_ADDRESS_REQUIRED':
      return 'This salon location is missing an address and cannot take bookings.'
    case 'LOCATION_NOT_FOUND':
      return 'Location not found or not bookable.'
    case 'TIMEZONE_REQUIRED':
      return 'This location must set a valid timezone before taking bookings.'
    case 'WORKING_HOURS_REQUIRED':
      return 'Working hours are not set for this location.'
    case 'WORKING_HOURS_INVALID':
      return 'Working hours are misconfigured for this location.'
    case 'MODE_NOT_SUPPORTED':
      return 'This service is not bookable for the selected appointment type.'
    case 'DURATION_REQUIRED':
      return 'Duration is not set for the selected offering.'
    case 'PRICE_REQUIRED':
      return 'Pricing is not set for the selected offering.'
    case 'COORDINATES_REQUIRED':
      return 'This location is missing coordinates required for this booking flow.'
    case 'NO_SCHEDULING_READY_LOCATION':
      return 'No scheduling-ready location found for this service.'
  }
}

function buildOtherProsVersion(args: {
  professionalId: string
  serviceId: string
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  effectiveLocationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  viewerLat: number | null
  viewerLng: number | null
  radiusMiles: number
  limit: number
}) {
  const raw = JSON.stringify({
    v: 1,
    ...args,
  })

  const digest = createHash('sha256').update(raw).digest('hex')
  return `other-pros:${digest.slice(0, 24)}`
}

async function validateAvailabilityPlacement(args: {
  professionalId: string
  requestedLocationId: string | null
  locationType: ServiceLocationType
  offering: OfferingSchedulingSnapshot
  clientAddressId: string | null
  allowFallback: boolean
}): Promise<AvailabilityPlacementResult> {
  const validated = await resolveValidatedBookingContext({
    professionalId: args.professionalId,
    requestedLocationId: args.requestedLocationId,
    locationType: args.locationType,
    fallbackTimeZone: 'UTC',
    requireValidTimeZone: true,
    allowFallback: args.allowFallback,
    requireCoordinates: false,
    offering: args.offering,
  })

  if (!validated.ok) {
    return {
      ok: false,
      code: validated.error,
      error: mapPlacementError(validated.error),
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
      error: mapPlacementError('CLIENT_SERVICE_ADDRESS_REQUIRED'),
    }
  }

  if (
    args.locationType === ServiceLocationType.SALON &&
    !formattedAddress
  ) {
    return {
      ok: false,
      code: 'SALON_LOCATION_ADDRESS_REQUIRED',
      error: mapPlacementError('SALON_LOCATION_ADDRESS_REQUIRED'),
    }
  }

  return {
    ok: true,
    location: context.location,
    locationId: context.locationId,
    locationType: args.locationType,
    timeZone: sanitizeTimeZone(context.timeZone, 'UTC'),
    lat: context.lat,
    lng: context.lng,
  }
}

async function resolveAvailabilityPlacement(args: {
  professionalId: string
  offering: OfferingSchedulingSnapshot
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  clientAddressId: string | null
}): Promise<AvailabilityPlacementResult> {
  const professionalId = args.professionalId.trim()
  const requestedLocationId = args.requestedLocationId?.trim() || null

  if (!professionalId) {
    return {
      ok: false,
      code: 'NO_SCHEDULING_READY_LOCATION',
      error: mapPlacementError('NO_SCHEDULING_READY_LOCATION'),
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
        error: mapPlacementError('MODE_NOT_SUPPORTED'),
      }
    }

    return validateAvailabilityPlacement({
      professionalId,
      requestedLocationId,
      locationType: effectiveLocationType,
      offering: args.offering,
      clientAddressId: args.clientAddressId,
      allowFallback: !requestedLocationId,
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
        error: mapPlacementError('LOCATION_NOT_FOUND'),
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
    })
  }

  const allowedTypes: ProfessionalLocationType[] = []

  if (args.offering.offersInSalon) {
    allowedTypes.push(
      ProfessionalLocationType.SALON,
      ProfessionalLocationType.SUITE,
    )
  }

  if (args.offering.offersMobile) {
    allowedTypes.push(ProfessionalLocationType.MOBILE_BASE)
  }

  if (!allowedTypes.length) {
    return {
      ok: false,
      code: 'MODE_NOT_SUPPORTED',
      error: mapPlacementError('MODE_NOT_SUPPORTED'),
    }
  }

  const candidates = await prisma.professionalLocation.findMany({
    where: {
      professionalId,
      isBookable: true,
      type: { in: allowedTypes },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: LOCATION_SELECT,
    take: 50,
  })

  const attempts = await Promise.all(
    candidates.map(async (candidate) => {
      const locationType = locationTypeForLocation(candidate)
      return validateAvailabilityPlacement({
        professionalId,
        requestedLocationId: candidate.id,
        locationType,
        offering: args.offering,
        clientAddressId: args.clientAddressId,
        allowFallback: false,
      })
    }),
  )

  for (const attempt of attempts) {
    if (attempt.ok) return attempt
  }

  const firstMeaningfulError = attempts.find(
    (attempt) => !attempt.ok && attempt.code !== 'LOCATION_NOT_FOUND',
  )

  return (
    firstMeaningfulError ?? {
      ok: false,
      code: 'NO_SCHEDULING_READY_LOCATION',
      error: mapPlacementError('NO_SCHEDULING_READY_LOCATION'),
    }
  )
}

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const earthRadiusMiles = 3958.7613
  const toRad = (degrees: number) => (degrees * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const sin1 = Math.sin(dLat / 2)
  const sin2 = Math.sin(dLng / 2)

  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(h)))
}

function boundsForRadiusMiles(
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
) {
  const latDelta = radiusMiles / 69
  const cos = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180))
  const lngDelta = radiusMiles / (69 * cos)

  return {
    minLat: clampFloat(centerLat - latDelta, -90, 90),
    maxLat: clampFloat(centerLat + latDelta, -90, 90),
    minLng: clampFloat(centerLng - lngDelta, -180, 180),
    maxLng: clampFloat(centerLng + lngDelta, -180, 180),
  }
}

function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(String(n))
}

async function loadOtherProsNearby(args: {
  centerLat: number
  centerLng: number
  radiusMiles: number
  serviceId: string
  locationType: ServiceLocationType
  excludeProfessionalId: string
  limit: number
}): Promise<OtherProRow[]> {
  const {
    centerLat,
    centerLng,
    radiusMiles,
    serviceId,
    locationType,
    excludeProfessionalId,
    limit,
  } = args

  const bounds = boundsForRadiusMiles(centerLat, centerLng, radiusMiles)
  const allowedTypes = allowedProfessionalTypes(locationType)

  const candidateLocs = await prisma.professionalLocation.findMany({
    where: {
      isBookable: true,
      professionalId: { not: excludeProfessionalId },
      type: { in: allowedTypes },
      timeZone: { not: null },
      workingHours: { not: Prisma.JsonNull },
      lat: {
        not: null,
        gte: toDecimal(bounds.minLat),
        lte: toDecimal(bounds.maxLat),
      },
      lng: {
        not: null,
        gte: toDecimal(bounds.minLng),
        lte: toDecimal(bounds.maxLng),
      },
    },
    select: {
      id: true,
      professionalId: true,
      type: true,
      timeZone: true,
      workingHours: true,
      lat: true,
      lng: true,
      city: true,
      formattedAddress: true,
      isPrimary: true,
      createdAt: true,
    },
    take: 800,
  })

  const center = { lat: centerLat, lng: centerLng }

  const bestByPro = new Map<
    string,
    {
      locationId: string
      timeZone: string
      distanceMiles: number
      isPrimary: boolean
      createdAt: Date
      city: string | null
      formattedAddress: string | null
    }
  >()

  for (const location of candidateLocs) {
    const lat = decimalToNumber(location.lat)
    const lng = decimalToNumber(location.lng)
    if (lat == null || lng == null) continue

    const tz =
      typeof location.timeZone === 'string' ? location.timeZone.trim() : ''
    if (!tz || !isValidIanaTimeZone(tz)) continue

    if (!location.workingHours || !isRecord(location.workingHours)) continue

    if (
      locationType === ServiceLocationType.SALON &&
      !normalizeAddress(location.formattedAddress)
    ) {
      continue
    }

    const distanceMiles = haversineMiles(center, { lat, lng })
    if (distanceMiles > radiusMiles) continue

    const prev = bestByPro.get(location.professionalId)
    if (!prev) {
      bestByPro.set(location.professionalId, {
        locationId: location.id,
        timeZone: tz,
        distanceMiles,
        isPrimary: Boolean(location.isPrimary),
        createdAt: location.createdAt,
        city: location.city ?? null,
        formattedAddress: normalizeAddress(location.formattedAddress),
      })
      continue
    }

    const better =
      distanceMiles < prev.distanceMiles ||
      (Math.abs(distanceMiles - prev.distanceMiles) < 1e-9 &&
        Boolean(location.isPrimary) &&
        !prev.isPrimary) ||
      (Math.abs(distanceMiles - prev.distanceMiles) < 1e-9 &&
        Boolean(location.isPrimary) === prev.isPrimary &&
        location.createdAt < prev.createdAt)

    if (better) {
      bestByPro.set(location.professionalId, {
        locationId: location.id,
        timeZone: tz,
        distanceMiles,
        isPrimary: Boolean(location.isPrimary),
        createdAt: location.createdAt,
        city: location.city ?? null,
        formattedAddress: normalizeAddress(location.formattedAddress),
      })
    }
  }

  const proIds = Array.from(bestByPro.keys())
  if (!proIds.length) return []

  const offeringRows = await prisma.professionalServiceOffering.findMany({
    where: {
      professionalId: { in: proIds },
      serviceId,
      isActive: true,
      ...(locationType === ServiceLocationType.MOBILE
        ? {
            offersMobile: true,
            mobilePriceStartingAt: { not: null },
            mobileDurationMinutes: { not: null },
          }
        : {
            offersInSalon: true,
            salonPriceStartingAt: { not: null },
            salonDurationMinutes: { not: null },
          }),
    },
    select: {
      id: true,
      professionalId: true,
      professional: {
        select: {
          id: true,
          businessName: true,
          avatarUrl: true,
          location: true,
        },
      },
    },
    take: 2000,
  })

  const offeringByPro = new Map<
    string,
    {
      offeringId: string
      businessName: string | null
      avatarUrl: string | null
      proLocation: string | null
    }
  >()

  for (const offering of offeringRows) {
    offeringByPro.set(offering.professionalId, {
      offeringId: offering.id,
      businessName: offering.professional.businessName ?? null,
      avatarUrl: offering.professional.avatarUrl ?? null,
      proLocation: offering.professional.location ?? null,
    })
  }

  const out: OtherProRow[] = []

  for (const proId of proIds) {
    const best = bestByPro.get(proId)
    const offering = offeringByPro.get(proId)
    if (!best || !offering) continue

    const locationLabel =
      (offering.proLocation && offering.proLocation.trim()) ||
      (best.city && best.city.trim()) ||
      (best.formattedAddress && best.formattedAddress.trim()) ||
      null

    out.push({
      id: proId,
      businessName: offering.businessName,
      avatarUrl: offering.avatarUrl,
      location: locationLabel,
      offeringId: offering.offeringId,
      timeZone: best.timeZone,
      locationId: best.locationId,
      distanceMiles: Math.round(best.distanceMiles * 10) / 10,
    })
  }

  out.sort((a, b) => a.distanceMiles - b.distanceMiles)
  return out.slice(0, Math.max(0, limit))
}

function parseCachedOtherProsRows(raw: unknown): OtherProRow[] | null {
  if (!Array.isArray(raw)) return null

  const parsed: OtherProRow[] = []

  for (const row of raw) {
    if (!isRecord(row)) return null

    const id = pickString(row.id)
    const offeringId = pickString(row.offeringId)
    const timeZone = pickString(row.timeZone)
    const locationId = pickString(row.locationId)
    const distanceMilesRaw =
      typeof row.distanceMiles === 'number' ? row.distanceMiles : Number.NaN

    if (
      !id ||
      !offeringId ||
      !timeZone ||
      !locationId ||
      !Number.isFinite(distanceMilesRaw)
    ) {
      return null
    }

    parsed.push({
      id,
      businessName: pickString(row.businessName) ?? null,
      avatarUrl: pickString(row.avatarUrl) ?? null,
      location: pickString(row.location) ?? null,
      offeringId,
      timeZone,
      locationId,
      distanceMiles: distanceMilesRaw,
    })
  }

  return parsed
}

async function loadOtherProsNearbyCached(args: {
  centerLat: number
  centerLng: number
  radiusMiles: number
  serviceId: string
  locationType: ServiceLocationType
  excludeProfessionalId: string
  limit: number
  cacheEnabled: boolean
}): Promise<OtherProRow[]> {
  if (!args.cacheEnabled || !redis) {
    return loadOtherProsNearby({
      centerLat: args.centerLat,
      centerLng: args.centerLng,
      radiusMiles: args.radiusMiles,
      serviceId: args.serviceId,
      locationType: args.locationType,
      excludeProfessionalId: args.excludeProfessionalId,
      limit: args.limit,
    })
  }

  const key = [
    'avail:otherPros:v3',
    args.serviceId,
    args.locationType,
    args.excludeProfessionalId,
    String(Math.round(args.centerLat * 1000) / 1000),
    String(Math.round(args.centerLng * 1000) / 1000),
    String(Math.round(args.radiusMiles * 10) / 10),
    String(args.limit),
  ].join(':')

  const hit = await cacheGetJson<unknown>(key)
  const parsedHit = parseCachedOtherProsRows(hit)
  if (parsedHit) {
    return parsedHit
  }

  const fresh = await loadOtherProsNearby({
    centerLat: args.centerLat,
    centerLng: args.centerLng,
    radiusMiles: args.radiusMiles,
    serviceId: args.serviceId,
    locationType: args.locationType,
    excludeProfessionalId: args.excludeProfessionalId,
    limit: args.limit,
  })

  void cacheSetJson(key, fresh, TTL_OTHER_PROS_SECONDS)

  return fresh
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const professionalId = pickString(searchParams.get('professionalId'))
    const serviceId = pickString(searchParams.get('serviceId'))
    const clientAddressId = pickString(searchParams.get('clientAddressId'))
    const requestedLocationType = normalizeLocationType(
      searchParams.get('locationType'),
    )
    const requestedLocationId = pickString(searchParams.get('locationId'))
    const debug = pickString(searchParams.get('debug')) === '1'

    const viewerLat = parseFloatParam(searchParams.get('viewerLat'))
    const viewerLng = parseFloatParam(searchParams.get('viewerLng'))
    const radiusMilesRaw = parseFloatParam(searchParams.get('radiusMiles'))
    const radiusMiles = clampFloat(radiusMilesRaw ?? 15, 5, 50)
    const limitRaw = parseFloatParam(searchParams.get('limit'))
    const limit = Math.min(Math.max(Math.trunc(limitRaw ?? 6), 1), 12)

    if (!professionalId || !serviceId) {
      return jsonFail(400, 'Missing professionalId or serviceId.')
    }

    const placementCacheKey = debug
      ? null
      : buildPlacementCacheKey({
          professionalId,
          serviceId,
          locationType: requestedLocationType,
          locationId: requestedLocationId,
          clientAddressId,
        })

    const cachedPlacement = placementCacheKey
      ? parseCachedPlacement(await cacheGetJson(placementCacheKey))
      : null

    let effectiveLocationType: ServiceLocationType
    let placementLat: number | undefined
    let placementLng: number | undefined
    let locationId: string
    let timeZone: string

    if (cachedPlacement) {
      effectiveLocationType = cachedPlacement.locationType
      placementLat = cachedPlacement.lat
      placementLng = cachedPlacement.lng
      locationId = cachedPlacement.locationId
      timeZone = cachedPlacement.timeZone
    } else {
      const offering = await prisma.professionalServiceOffering.findFirst({
        where: {
          professionalId,
          serviceId,
          isActive: true,
        },
        select: {
          id: true,
          offersInSalon: true,
          offersMobile: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
        },
      })

      if (!offering) {
        return jsonFail(404, 'Offering not found')
      }

      const placement = await resolveAvailabilityPlacement({
        professionalId,
        offering: buildOfferingSnapshot(offering),
        requestedLocationType,
        requestedLocationId,
        clientAddressId,
      })

      if (!placement.ok) {
        return jsonFail(400, placement.error)
      }

      effectiveLocationType = placement.locationType
      placementLat = placement.lat
      placementLng = placement.lng
      locationId = placement.locationId
      timeZone = placement.timeZone

      if (placementCacheKey) {
        void cacheSetJson(
          placementCacheKey,
          {
            locationId,
            locationType: effectiveLocationType,
            timeZone,
            lat: placementLat,
            lng: placementLng,
          } satisfies CachedPlacement,
          TTL_PLACEMENT_SECONDS,
        )
      }
    }

    const hasViewer =
      typeof viewerLat === 'number' && typeof viewerLng === 'number'

    const centerLat = hasViewer ? viewerLat : placementLat
    const centerLng = hasViewer ? viewerLng : placementLng

    const request: OtherProsRequestPayload = {
      professionalId,
      serviceId,
      requestedLocationType,
      requestedLocationId,
      effectiveLocationType,
      locationId,
      clientAddressId,
      viewer:
        hasViewer && viewerLat != null && viewerLng != null
          ? {
              lat: viewerLat,
              lng: viewerLng,
              radiusMiles,
              placeId: pickString(searchParams.get('viewerPlaceId')),
            }
          : null,
      limit,
    }

    const generatedAt = new Date().toISOString()
    const availabilityVersion = buildOtherProsVersion({
      professionalId,
      serviceId,
      requestedLocationType,
      requestedLocationId,
      effectiveLocationType,
      locationId,
      clientAddressId,
      viewerLat,
      viewerLng,
      radiusMiles,
      limit,
    })

    if (centerLat == null || centerLng == null) {
      return jsonOk({
        ok: true,
        mode: 'OTHER_PROS' as const,
        availabilityVersion,
        generatedAt,
        request,
        professionalId,
        serviceId,
        locationType: effectiveLocationType,
        locationId,
        timeZone,
        radiusMiles,
        usedViewerCenter: false,
        center: null,
        otherPros: [],
      })
    }

    const otherPros = await loadOtherProsNearbyCached({
      centerLat,
      centerLng,
      radiusMiles,
      serviceId,
      locationType: effectiveLocationType,
      excludeProfessionalId: professionalId,
      limit,
      cacheEnabled: !debug,
    })

    return jsonOk({
      ok: true,
      mode: 'OTHER_PROS' as const,
      availabilityVersion,
      generatedAt,
      request,
      professionalId,
      serviceId,
      locationType: effectiveLocationType,
      locationId,
      timeZone,
      radiusMiles,
      usedViewerCenter: hasViewer,
      center: {
        lat: centerLat,
        lng: centerLng,
      },
      otherPros,
    })
  } catch (err: unknown) {
    console.error('GET /api/availability/other-pros error', err)
    return jsonFail(500, 'Failed to load nearby professionals')
  }
}
