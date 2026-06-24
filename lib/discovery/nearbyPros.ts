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
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'
import { fetchProSearchCandidates } from '@/lib/search/pros'
import { proDiscoveryVisibilityFilter, type TenantContext } from '@/lib/tenant'

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

// `/api/pros/nearby` is unauthenticated. Exact (rooftop-precision) coordinates
// reverse-geocode to a pro's address — which for mobile/home-based pros is their
// residence — and `formattedAddress`/`placeId` are the address outright. So the
// public payload must carry only coarse, neighborhood-level location. Distance
// is computed server-side from the exact coordinates BEFORE this redaction, so
// the displayed distance stays accurate; only the map pin is approximate.
const PUBLIC_COORD_DECIMALS = 2 // ~1.1 km grid

function coarsenPublicCoordinate(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const factor = 10 ** PUBLIC_COORD_DECIMALS
  return Math.round(value * factor) / factor
}

function toPublicDiscoveryLocation(
  location: DiscoveryLocationDto,
): DiscoveryLocationDto {
  return {
    ...location,
    formattedAddress: null,
    placeId: null,
    lat: coarsenPublicCoordinate(location.lat),
    lng: coarsenPublicCoordinate(location.lng),
  }
}

/**
 * Redact a nearby card for an UNAUTHENTICATED audience: strip the exact street
 * address + place id and coarsen coordinates to a neighborhood grid on both the
 * closest and primary location. Apply this at the public route boundary — never
 * inside `loadNearbyPros`, whose exact output also feeds the search index.
 */
export function toPublicNearbyProCard(card: NearbyProCard): NearbyProCard {
  return {
    ...card,
    closestLocation: toPublicDiscoveryLocation(card.closestLocation),
    primaryLocation: toPublicDiscoveryLocation(card.primaryLocation),
  }
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

function toRatingCount(value: number | bigint): number {
  const n = typeof value === 'bigint' ? Number(value) : value
  return Number.isFinite(n) ? n : 0
}

// New path: delegate the geo prefilter + dedup + rating/price rollups to the
// shared ProfessionalSearchIndex (GIST) read, then map to NearbyProCard. This
// replaces the bounding-box + JS haversine + live review/offering queries with
// the same index the search list already uses (single source of truth) and
// fixes the under-indexed `(isPrimary,isBookable,lat,lng)` scan.
//
// Behaviour difference vs legacy (intentional): ranks by the *closest* bookable
// location, not the primary one. Rating/price come from the event-refreshed
// index rather than a live query. Gated by the `nearby_search_index_enabled`
// runtime flag so it can be verified on staging and reverted instantly.
async function loadNearbyProsViaSearchIndex(
  args: NearbyProsArgs,
  tenantContext: TenantContext,
): Promise<NearbyProCard[]> {
  const candidates = await fetchProSearchCandidates(
    {
      q: null,
      lat: args.lat,
      lng: args.lng,
      categoryId: args.categoryId,
      serviceId: args.serviceId,
      excludeProfessionalId: args.excludeProfessionalId,
      radiusMiles: args.radiusMiles,
      mobileOnly: false,
      openNowOnly: false,
      minRating: null,
      maxPrice: null,
      sort: 'DISTANCE',
      cursorId: null,
      limit: args.limit,
    },
    tenantContext,
  )

  const cards: NearbyProCard[] = []

  for (const entry of candidates) {
    const distanceMiles = entry.row.distanceMiles
    // ST_DWithin already bounds candidates to the radius; this guards the
    // NearbyProCard contract (non-null distance) and the no-origin edge.
    if (distanceMiles == null || !Number.isFinite(distanceMiles)) {
      continue
    }

    cards.push({
      id: entry.row.professionalId,
      businessName: entry.row.businessName,
      handle: entry.row.handle,
      professionType: entry.row.professionType,
      avatarUrl: entry.row.avatarUrl,
      locationLabel: buildDiscoveryLocationLabel({ location: entry.closest }),
      distanceMiles: roundDistanceMiles(distanceMiles),
      ratingAvg: entry.row.ratingAvg,
      ratingCount: toRatingCount(entry.row.ratingCount),
      minPrice: entry.row.minAnyPrice,
      supportsMobile: entry.row.offersMobile,
      closestLocation: entry.closest,
      primaryLocation: entry.primary ?? entry.closest,
    })
  }

  // Candidates already arrive distance-sorted (sort: 'DISTANCE'); enforce the
  // caller's limit to match the legacy contract.
  return cards.slice(0, args.limit)
}

// Public entry point — dispatches to the search-index path when enabled,
// otherwise the legacy bounding-box path. Defaults to legacy (flag off).
export async function loadNearbyPros(
  args: NearbyProsArgs,
  tenantContext: TenantContext,
): Promise<NearbyProCard[]> {
  if (await isRuntimeFlagEnabled('nearby_search_index_enabled')) {
    return loadNearbyProsViaSearchIndex(args, tenantContext)
  }

  return loadNearbyProsLegacy(args, tenantContext)
}

async function loadNearbyProsLegacy(
  args: NearbyProsArgs,
  tenantContext: TenantContext,
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
        ...proDiscoveryVisibilityFilter(tenantContext),
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
