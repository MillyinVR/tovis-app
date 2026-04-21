// lib/availability/data/otherPros.ts

import {
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'

import { pickString } from '@/app/api/_utils/pick'
import {
  buildOtherProsCacheKey,
  cacheGetJson,
  cacheSetJson,
} from '@/lib/availability/data/cache'
import { decimalToNumber } from '@/lib/booking/snapshots'
import {
  buildDiscoveryLocationLabel,
  boundsForRadiusMiles,
  haversineMiles,
} from '@/lib/discovery/nearby'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone } from '@/lib/timeZone'

const TTL_OTHER_PROS_SECONDS = 600

export type OtherProRow = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  offeringId: string
  timeZone: string
  locationId: string
  distanceMiles: number
}

export type LoadOtherProsNearbyArgs = {
  centerLat: number
  centerLng: number
  radiusMiles: number
  serviceId: string
  locationType: ServiceLocationType
  excludeProfessionalId: string
  limit: number
}

export type LoadOtherProsNearbyCachedArgs = LoadOtherProsNearbyArgs & {
  cacheEnabled: boolean
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(String(value))
}

function allowedProfessionalTypes(
  locationType: ServiceLocationType,
): ProfessionalLocationType[] {
  return locationType === ServiceLocationType.MOBILE
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function parseCachedOtherPros(value: unknown): OtherProRow[] | null {
  if (!Array.isArray(value)) return null

  const parsed: OtherProRow[] = []

  for (const row of value) {
    if (!isRecord(row)) continue

    const id = pickString(row.id)
    const offeringId = pickString(row.offeringId)
    const timeZone = pickString(row.timeZone)
    const locationId = pickString(row.locationId)
    const distanceMiles =
      typeof row.distanceMiles === 'number' ? row.distanceMiles : Number.NaN

    if (
      !id ||
      !offeringId ||
      !timeZone ||
      !locationId ||
      !Number.isFinite(distanceMiles)
    ) {
      continue
    }

    parsed.push({
      id,
      businessName: pickString(row.businessName) ?? null,
      avatarUrl: pickString(row.avatarUrl) ?? null,
      location: pickString(row.location) ?? null,
      offeringId,
      timeZone,
      locationId,
      distanceMiles,
    })
  }

  return parsed.length > 0 ? parsed : null
}

export async function loadOtherProsNearby(
  args: LoadOtherProsNearbyArgs,
): Promise<OtherProRow[]> {
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

  const candidateLocations = await prisma.professionalLocation.findMany({
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
      state: true,
      formattedAddress: true,
      isPrimary: true,
      createdAt: true,
    },
    take: 800,
  })

  const center = { lat: centerLat, lng: centerLng }

  const bestLocationByPro = new Map<
    string,
    {
      locationId: string
      timeZone: string
      distanceMiles: number
      isPrimary: boolean
      createdAt: Date
      city: string | null
      state: string | null
      formattedAddress: string | null
    }
  >()

  for (const location of candidateLocations) {
    const lat = decimalToNumber(location.lat)
    const lng = decimalToNumber(location.lng)
    if (lat == null || lng == null) continue

    const timeZone =
      typeof location.timeZone === 'string' ? location.timeZone.trim() : ''
    if (!timeZone || !isValidIanaTimeZone(timeZone)) continue

    if (!location.workingHours || !isRecord(location.workingHours)) continue

    if (
      locationType === ServiceLocationType.SALON &&
      !normalizeAddress(location.formattedAddress)
    ) {
      continue
    }

    const distanceMiles = haversineMiles(center, { lat, lng })
    if (distanceMiles > radiusMiles) continue

    const previous = bestLocationByPro.get(location.professionalId)
    if (!previous) {
      bestLocationByPro.set(location.professionalId, {
        locationId: location.id,
        timeZone,
        distanceMiles,
        isPrimary: Boolean(location.isPrimary),
        createdAt: location.createdAt,
        city: location.city ?? null,
        state: location.state ?? null,
        formattedAddress: normalizeAddress(location.formattedAddress),
      })
      continue
    }

    const isBetter =
      distanceMiles < previous.distanceMiles ||
      (Math.abs(distanceMiles - previous.distanceMiles) < 1e-9 &&
        Boolean(location.isPrimary) &&
        !previous.isPrimary) ||
      (Math.abs(distanceMiles - previous.distanceMiles) < 1e-9 &&
        Boolean(location.isPrimary) === previous.isPrimary &&
        location.createdAt < previous.createdAt)

    if (isBetter) {
      bestLocationByPro.set(location.professionalId, {
        locationId: location.id,
        timeZone,
        distanceMiles,
        isPrimary: Boolean(location.isPrimary),
        createdAt: location.createdAt,
        city: location.city ?? null,
        state: location.state ?? null,
        formattedAddress: normalizeAddress(location.formattedAddress),
      })
    }
  }

  const professionalIds = Array.from(bestLocationByPro.keys())
  if (!professionalIds.length) return []

  const offeringRows = await prisma.professionalServiceOffering.findMany({
    where: {
      professionalId: { in: professionalIds },
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
    }
  >()

  for (const offering of offeringRows) {
    offeringByPro.set(offering.professionalId, {
      offeringId: offering.id,
      businessName: offering.professional.businessName ?? null,
      avatarUrl: offering.professional.avatarUrl ?? null,
    })
  }

  const results: OtherProRow[] = []

  for (const professionalId of professionalIds) {
    const bestLocation = bestLocationByPro.get(professionalId)
    const offering = offeringByPro.get(professionalId)
    if (!bestLocation || !offering) continue

    const locationLabel = buildDiscoveryLocationLabel({
      location: {
        formattedAddress: bestLocation.formattedAddress,
        city: bestLocation.city,
        state: bestLocation.state,
      },
    })

    results.push({
      id: professionalId,
      businessName: offering.businessName,
      avatarUrl: offering.avatarUrl,
      location: locationLabel,
      offeringId: offering.offeringId,
      timeZone: bestLocation.timeZone,
      locationId: bestLocation.locationId,
      distanceMiles: Math.round(bestLocation.distanceMiles * 10) / 10,
    })
  }

  results.sort((a, b) => a.distanceMiles - b.distanceMiles)
  return results.slice(0, Math.max(0, limit))
}

export async function loadOtherProsNearbyCached(
  args: LoadOtherProsNearbyCachedArgs,
): Promise<OtherProRow[]> {
  if (!args.cacheEnabled) {
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

  const key = buildOtherProsCacheKey({
    serviceId: args.serviceId,
    locationType: args.locationType,
    excludeProfessionalId: args.excludeProfessionalId,
    centerLat: args.centerLat,
    centerLng: args.centerLng,
    radiusMiles: args.radiusMiles,
    limit: args.limit,
  })

  const hit = await cacheGetJson<unknown>(key)
  const parsedHit = parseCachedOtherPros(hit)
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