// lib/search/pros.ts
import {
  buildDiscoveryLocationLabel,
  buildDiscoveryOfferSummaryMap,
  inferProfessionTypesFromQuery,
  isOpenNowAtLocation,
  mapProfessionalLocation,
  matchesDiscoveryOfferingFilters,
  pickClosestLocationWithinRadius,
  pickPrimaryLocation,
  type DiscoveryLocationDto,
  type DiscoveryOfferSummaryDto,
} from '@/lib/discovery/nearby'
import { prisma } from '@/lib/prisma'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'
import {
  SearchRequestError,
  type SearchProItemDto,
  type SearchProLocationPreviewDto,
  type SearchProsResponseDto,
  clampInt,
  decodeIdCursor,
  normalizeOptionalId,
  paginateByCursor,
  parseBooleanParam,
  parseLimit,
  pickFiniteNumber,
  pickNonEmptyString,
} from './contracts'

export type SearchProsSort =
  | 'DISTANCE'
  | 'RATING'
  | 'PRICE'
  | 'NAME'

export type SearchProsParams = {
  q: string | null
  lat: number | null
  lng: number | null
  categoryId: string | null
  radiusMiles: number
  mobileOnly: boolean
  openNowOnly: boolean
  minRating: number | null
  maxPrice: number | null
  sort: SearchProsSort
  cursorId: string | null
  limit: number
}

function normalizeSearchProsSort(
  value: string | null,
): SearchProsSort {
  const normalized = (value ?? '').trim().toUpperCase()

  if (normalized === 'RATING') return 'RATING'
  if (normalized === 'PRICE') return 'PRICE'
  if (normalized === 'NAME') return 'NAME'

  return 'DISTANCE'
}

export function parseSearchProsParams(
  searchParams: URLSearchParams,
): SearchProsParams {
  const rawCursor = pickNonEmptyString(searchParams.get('cursor'))
  const cursorId = rawCursor ? decodeIdCursor(rawCursor) : null

  if (rawCursor && !cursorId) {
    throw new SearchRequestError(400, 'Invalid pros search cursor.')
  }

  const radiusMiles = (() => {
    const parsed = pickFiniteNumber(searchParams.get('radiusMiles')) ?? 15
    return clampInt(parsed, 1, 100)
  })()

  return {
    q: pickNonEmptyString(searchParams.get('q')),
    lat: pickFiniteNumber(searchParams.get('lat')),
    lng: pickFiniteNumber(searchParams.get('lng')),
    categoryId: normalizeOptionalId(searchParams.get('categoryId')),
    radiusMiles,
    mobileOnly: parseBooleanParam(searchParams.get('mobile')),
    openNowOnly: parseBooleanParam(searchParams.get('openNow')),
    minRating: pickFiniteNumber(searchParams.get('minRating')),
    maxPrice: pickFiniteNumber(searchParams.get('maxPrice')),
    sort: normalizeSearchProsSort(searchParams.get('sort')),
    cursorId,
    limit: parseLimit(searchParams.get('limit'), {
      defaultValue: 50,
      max: 50,
    }),
  }
}

function emptyOfferSummary(
  professionalId: string,
): DiscoveryOfferSummaryDto {
  return {
    professionalId,
    supportsSalon: false,
    supportsMobile: false,
    minSalon: null,
    minMobile: null,
    minAny: null,
    categoryIds: [],
  }
}

function mapLocationPreview(
  location: DiscoveryLocationDto | null,
): SearchProLocationPreviewDto | null {
  if (!location) return null

  return {
    id: location.id,
    formattedAddress: location.formattedAddress,
    city: location.city,
    state: location.state,
    timeZone: location.timeZone,
    placeId: location.placeId,
    lat: location.lat,
    lng: location.lng,
    isPrimary: location.isPrimary,
  }
}

function compareByBusinessNameThenId(
  a: {
    pro: { id: string; businessName: string | null }
  },
  b: {
    pro: { id: string; businessName: string | null }
  },
): number {
  const aName = (a.pro.businessName ?? '').toLowerCase()
  const bName = (b.pro.businessName ?? '').toLowerCase()

  const byName = aName.localeCompare(bName)
  if (byName !== 0) return byName

  return a.pro.id.localeCompare(b.pro.id)
}

export async function searchPros(
  params: SearchProsParams,
): Promise<SearchProsResponseDto> {
  const origin =
    params.lat != null && params.lng != null
      ? { lat: params.lat, lng: params.lng }
      : null

  const matchedProfessions = params.q
    ? inferProfessionTypesFromQuery(params.q)
    : []

  const pros = await prisma.professionalProfile.findMany({
    where: {
      verificationStatus: {
        in: [...PUBLICLY_APPROVED_PRO_STATUSES],
      },
      ...(params.q
        ? {
            OR: [
              {
                businessName: {
                  contains: params.q,
                  mode: 'insensitive',
                },
              },
              {
                handle: {
                  contains: params.q,
                  mode: 'insensitive',
                },
              },
              {
                location: {
                  contains: params.q,
                  mode: 'insensitive',
                },
              },
              ...(matchedProfessions.length > 0
                ? [{ professionType: { in: matchedProfessions } }]
                : []),
            ],
          }
        : {}),
    },
    take: 200,
    orderBy: [
      { businessName: 'asc' },
      { handleNormalized: 'asc' },
    ],
    select: {
      id: true,
      businessName: true,
      handle: true,
      professionType: true,
      avatarUrl: true,
      location: true,
      locations: {
        where: {
          isBookable: true,
          lat: { not: null },
          lng: { not: null },
        },
        take: 25,
        select: {
          id: true,
          formattedAddress: true,
          city: true,
          state: true,
          timeZone: true,
          placeId: true,
          lat: true,
          lng: true,
          isPrimary: true,
          workingHours: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  })

  const proIds = pros.map((pro) => pro.id)

  const ratingRows =
    proIds.length > 0
      ? await prisma.review.groupBy({
          by: ['professionalId'],
          where: {
            professionalId: {
              in: proIds,
            },
          },
          _avg: { rating: true },
          _count: { _all: true },
        })
      : []

  const ratingByPro = new Map<
    string,
    { avg: number | null; count: number }
  >()

  for (const row of ratingRows) {
    ratingByPro.set(row.professionalId, {
      avg:
        typeof row._avg.rating === 'number'
          ? row._avg.rating
          : null,
      count: row._count._all ?? 0,
    })
  }

  const offeringRows =
    proIds.length > 0
      ? await prisma.professionalServiceOffering.findMany({
          where: {
            professionalId: {
              in: proIds,
            },
            isActive: true,
            service: {
              isActive: true,
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
                categoryId: true,
              },
            },
          },
        })
      : []

  const offerByPro = buildDiscoveryOfferSummaryMap(
    offeringRows.map((offering) => ({
      professionalId: offering.professionalId,
      offersInSalon: offering.offersInSalon,
      offersMobile: offering.offersMobile,
      salonPriceStartingAt: offering.salonPriceStartingAt,
      mobilePriceStartingAt: offering.mobilePriceStartingAt,
      categoryId: offering.service.categoryId,
    })),
  )

  const base = pros.map((pro) => {
    const locs = (pro.locations ?? [])
      .map((location) =>
        mapProfessionalLocation({
          id: location.id,
          formattedAddress: location.formattedAddress ?? null,
          city: location.city ?? null,
          state: location.state ?? null,
          timeZone: location.timeZone ?? null,
          placeId: location.placeId ?? null,
          lat: location.lat,
          lng: location.lng,
          isPrimary: Boolean(location.isPrimary),
          workingHours: location.workingHours,
        }),
      )
      .filter(
        (location) =>
          location.lat != null && location.lng != null,
      )

    const primary = pickPrimaryLocation(locs)
    const fallback = primary ?? locs[0] ?? null

    return {
      pro,
      locs,
      primary,
      fallback,
      rating: ratingByPro.get(pro.id) ?? {
        avg: null,
        count: 0,
      },
      offers:
        offerByPro.get(pro.id) ?? emptyOfferSummary(pro.id),
    }
  })

  type SearchBaseEntry = (typeof base)[number]

  type SearchResultEntry = SearchBaseEntry & {
    dist: number | null
    closest: DiscoveryLocationDto | null
  }

  const results: SearchResultEntry[] = origin
    ? base
        .map<SearchResultEntry | null>((entry) => {
          const best = pickClosestLocationWithinRadius({
            origin,
            locations: entry.locs,
            radiusMiles: params.radiusMiles,
          })

          if (!best) return null

          return {
            ...entry,
            dist: best.distanceMiles,
            closest: best.location,
          }
        })
        .filter(
          (entry): entry is SearchResultEntry => entry !== null,
        )
    : base.map<SearchResultEntry>((entry) => ({
        ...entry,
        dist: null,
        closest: entry.fallback,
      }))

  let filtered = results.filter((entry) =>
    matchesDiscoveryOfferingFilters({
      offerSummary: entry.offers,
      mobileOnly: params.mobileOnly,
      requestedCategoryId: params.categoryId,
    }),
  )

  const maxPrice = params.maxPrice
  if (maxPrice != null) {
    filtered = filtered.filter((entry) => {
      const price = params.mobileOnly
        ? entry.offers.minMobile
        : entry.offers.minAny

      return price != null && price <= maxPrice
    })
  }

  const minRating = params.minRating
  if (minRating != null) {
    filtered = filtered.filter(
      (entry) =>
        entry.rating.avg != null &&
        entry.rating.avg >= minRating,
    )
  }
  
  if (params.openNowOnly) {
    filtered = filtered.filter((entry) => {
      const location = entry.closest
      if (!location) return false

      return isOpenNowAtLocation({
        timeZone: location.timeZone,
        workingHours: location.workingHours,
      })
    })
  }

  filtered = filtered.sort((a, b) => {
    if (params.sort === 'NAME') {
      return compareByBusinessNameThenId(a, b)
    }

    if (params.sort === 'RATING') {
      const ratingDelta = (b.rating.avg ?? -1) - (a.rating.avg ?? -1)
      if (ratingDelta !== 0) return ratingDelta

      const countDelta =
        (b.rating.count ?? 0) - (a.rating.count ?? 0)
      if (countDelta !== 0) return countDelta

      return compareByBusinessNameThenId(a, b)
    }

    if (params.sort === 'PRICE') {
      const aPrice = params.mobileOnly
        ? a.offers.minMobile ?? Number.POSITIVE_INFINITY
        : a.offers.minAny ?? Number.POSITIVE_INFINITY

      const bPrice = params.mobileOnly
        ? b.offers.minMobile ?? Number.POSITIVE_INFINITY
        : b.offers.minAny ?? Number.POSITIVE_INFINITY

      const priceDelta = aPrice - bPrice
      if (priceDelta !== 0) return priceDelta

      return compareByBusinessNameThenId(a, b)
    }

    const aDistance = a.dist ?? Number.POSITIVE_INFINITY
    const bDistance = b.dist ?? Number.POSITIVE_INFINITY
    const distanceDelta = aDistance - bDistance

    if (distanceDelta !== 0) return distanceDelta
    return compareByBusinessNameThenId(a, b)
  })

  const items: SearchProItemDto[] = filtered.map((entry) => {
    const location = entry.closest

    return {
      id: entry.pro.id,
      businessName: entry.pro.businessName ?? null,
      handle: entry.pro.handle ?? null,
      professionType: entry.pro.professionType ?? null,
      avatarUrl: entry.pro.avatarUrl ?? null,
      locationLabel: buildDiscoveryLocationLabel({
        profileLocation: entry.pro.location ?? null,
        location: location ?? entry.primary ?? null,
      }),
      distanceMiles: entry.dist,
      ratingAvg: entry.rating.avg,
      ratingCount: entry.rating.count,
      minPrice: params.mobileOnly
        ? entry.offers.minMobile
        : entry.offers.minAny,
      supportsMobile: entry.offers.supportsMobile,
      closestLocation: mapLocationPreview(location),
      primaryLocation: mapLocationPreview(entry.primary),
    }
  })

  return paginateByCursor(items, {
    cursorId: params.cursorId,
    limit: params.limit,
  })
}