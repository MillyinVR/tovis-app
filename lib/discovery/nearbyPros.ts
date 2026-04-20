// lib/discovery/nearbyPros.ts
import { Prisma } from '@prisma/client'

import {
  boundsForRadiusMiles,
  buildDiscoveryLocationLabel,
  buildDiscoveryOfferSummaryMap,
  haversineMiles,
  mapProfessionalLocation,
  matchesDiscoveryOfferingFilters,
  type DiscoveryLocationDto,
} from '@/lib/discovery/nearby'
import { prisma } from '@/lib/prisma'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'

const LOCATION_SELECT = {
  id: true,
  professionalId: true,
  formattedAddress: true,
  city: true,
  state: true,
  timeZone: true,
  placeId: true,
  lat: true,
  lng: true,
  isPrimary: true,
  workingHours: true,
  createdAt: true,
  professional: {
    select: {
      id: true,
      businessName: true,
      handle: true,
      professionType: true,
      avatarUrl: true,
      location: true,
    },
  },
} satisfies Prisma.ProfessionalLocationSelect

type NearbyLocationRow = Prisma.ProfessionalLocationGetPayload<{
  select: typeof LOCATION_SELECT
}>

export type NearbyProsArgs = {
  lat: number
  lng: number
  radiusMiles: number
  categoryId: string | null
  serviceId: string | null
  excludeProfessionalId: string | null
  limit: number
}

export type NearbyProCard = {
  id: string
  businessName: string | null
  handle: string | null
  professionType: NearbyLocationRow['professional']['professionType'] | null
  avatarUrl: string | null
  locationLabel: string | null
  distanceMiles: number
  ratingAvg: number | null
  ratingCount: number
  minPrice: number | null
  supportsMobile: boolean
  closestLocation: DiscoveryLocationDto
  primaryLocation: DiscoveryLocationDto
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(String(value))
}

function roundDistanceMiles(value: number): number {
  return Math.round(value * 10) / 10
}

function compareNullableText(a: string | null, b: string | null): number {
  const left = (a ?? '').trim().toLowerCase()
  const right = (b ?? '').trim().toLowerCase()
  return left.localeCompare(right)
}

export async function loadNearbyPros(
  args: NearbyProsArgs,
): Promise<NearbyProCard[]> {
  const bounds = boundsForRadiusMiles(args.lat, args.lng, args.radiusMiles)

  const candidateLocations = await prisma.professionalLocation.findMany({
    where: {
      isPrimary: true,
      isBookable: true,
      ...(args.excludeProfessionalId
        ? { professionalId: { not: args.excludeProfessionalId } }
        : {}),
      professional: {
        verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
      },
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
    select: LOCATION_SELECT,
    orderBy: [{ createdAt: 'asc' }],
    take: 800,
  })

  const origin = { lat: args.lat, lng: args.lng }

  const bestPrimaryByPro = new Map<
    string,
    {
      pro: NearbyLocationRow['professional']
      location: DiscoveryLocationDto
      distanceMiles: number
      createdAt: Date
    }
  >()

  for (const row of candidateLocations) {
    const location = mapProfessionalLocation({
      id: row.id,
      formattedAddress: row.formattedAddress ?? null,
      city: row.city ?? null,
      state: row.state ?? null,
      timeZone: row.timeZone ?? null,
      placeId: row.placeId ?? null,
      lat: row.lat,
      lng: row.lng,
      isPrimary: Boolean(row.isPrimary),
      workingHours: row.workingHours,
    })

    if (location.lat == null || location.lng == null) {
      continue
    }

    const distanceMiles = haversineMiles(origin, {
      lat: location.lat,
      lng: location.lng,
    })

    if (!Number.isFinite(distanceMiles) || distanceMiles > args.radiusMiles) {
      continue
    }

    const previous = bestPrimaryByPro.get(row.professionalId)
    if (
      !previous ||
      distanceMiles < previous.distanceMiles ||
      (Math.abs(distanceMiles - previous.distanceMiles) < 1e-9 &&
        row.createdAt < previous.createdAt)
    ) {
      bestPrimaryByPro.set(row.professionalId, {
        pro: row.professional,
        location,
        distanceMiles,
        createdAt: row.createdAt,
      })
    }
  }

  const professionalIds = Array.from(bestPrimaryByPro.keys())
  if (professionalIds.length === 0) {
    return []
  }

  const [ratingRows, offeringRows] = await Promise.all([
    prisma.review.groupBy({
      by: ['professionalId'],
      where: {
        professionalId: { in: professionalIds },
      },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.professionalServiceOffering.findMany({
      where: {
        professionalId: { in: professionalIds },
        isActive: true,
        service: {
          isActive: true,
          ...(args.serviceId ? { id: args.serviceId } : {}),
          ...(args.categoryId ? { categoryId: args.categoryId } : {}),
        },
      },
      select: {
        professionalId: true,
        offersInSalon: true,
        offersMobile: true,
        salonPriceStartingAt: true,
        mobilePriceStartingAt: true,
        service: {
          select: {
            id: true,
            categoryId: true,
          },
        },
      },
    }),
  ])

  const ratingByPro = new Map<string, { avg: number | null; count: number }>()

  for (const row of ratingRows) {
    ratingByPro.set(row.professionalId, {
      avg: typeof row._avg.rating === 'number' ? row._avg.rating : null,
      count: row._count._all ?? 0,
    })
  }

  const matchedOfferingRows = offeringRows.filter((offering) => {
    if (args.serviceId && offering.service.id !== args.serviceId) {
      return false
    }

    return true
  })

  const offerByPro = buildDiscoveryOfferSummaryMap(
    matchedOfferingRows.map((offering) => ({
      professionalId: offering.professionalId,
      offersInSalon: offering.offersInSalon,
      offersMobile: offering.offersMobile,
      salonPriceStartingAt: offering.salonPriceStartingAt,
      mobilePriceStartingAt: offering.mobilePriceStartingAt,
      categoryId: offering.service.categoryId,
    })),
  )

  const results: NearbyProCard[] = []

  for (const professionalId of professionalIds) {
    const entry = bestPrimaryByPro.get(professionalId)
    const offers = offerByPro.get(professionalId)

    if (!entry || !offers) {
      continue
    }

    if (
      !matchesDiscoveryOfferingFilters({
        offerSummary: offers,
        requestedCategoryId: args.categoryId,
        mobileOnly: null,
      })
    ) {
      continue
    }

    const rating = ratingByPro.get(professionalId) ?? {
      avg: null,
      count: 0,
    }

    results.push({
      id: entry.pro.id,
      businessName: entry.pro.businessName ?? null,
      handle: entry.pro.handle ?? null,
      professionType: entry.pro.professionType ?? null,
      avatarUrl: entry.pro.avatarUrl ?? null,
      locationLabel: buildDiscoveryLocationLabel({
        profileLocation: entry.pro.location ?? null,
        location: entry.location,
      }),
      distanceMiles: roundDistanceMiles(entry.distanceMiles),
      ratingAvg: rating.avg,
      ratingCount: rating.count,
      minPrice: offers.minAny,
      supportsMobile: offers.supportsMobile,
      closestLocation: entry.location,
      primaryLocation: entry.location,
    })
  }

  results.sort((a, b) => {
    if (a.distanceMiles !== b.distanceMiles) {
      return a.distanceMiles - b.distanceMiles
    }

    const businessNameCompare = compareNullableText(
      a.businessName,
      b.businessName,
    )
    if (businessNameCompare !== 0) {
      return businessNameCompare
    }

    return compareNullableText(a.handle, b.handle)
  })

  return results.slice(0, args.limit)
}