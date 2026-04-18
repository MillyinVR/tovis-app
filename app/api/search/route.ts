// app/api/search/route.ts
import { Prisma } from '@prisma/client'

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import {
  buildDiscoveryLocationLabel,
  inferProfessionTypesFromQuery,
  isOpenNowAtLocation,
  mapProfessionalLocation,
  pickClosestLocationWithinRadius,
  pickPrimaryLocation,
  type DiscoveryLocationDto,
} from '@/lib/discovery/nearby'
import { prisma } from '@/lib/prisma'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'

export const dynamic = 'force-dynamic'

function pickNumber(value: string | null): number | null {
  if (!value) return null

  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseBool(value: string | null): boolean {
  const s = (value ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

type Sort = 'DISTANCE' | 'RATING' | 'PRICE' | 'NAME'

function normalizeSort(value: string | null): Sort {
  const s = (value ?? '').trim().toUpperCase()

  if (s === 'RATING') return 'RATING'
  if (s === 'PRICE') return 'PRICE'
  if (s === 'NAME') return 'NAME'

  return 'DISTANCE'
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function decToNum(value: unknown): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber()
  }

  return null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const q = (pickString(searchParams.get('q')) ?? '').trim()
    const tabRaw = (
      pickString(searchParams.get('tab')) ?? 'PROS'
    ).toUpperCase()
    const tab = tabRaw === 'SERVICES' ? 'SERVICES' : 'PROS'

    const lat = pickNumber(searchParams.get('lat'))
    const lng = pickNumber(searchParams.get('lng'))

    const radiusMiles = (() => {
      const r = pickNumber(searchParams.get('radiusMiles')) ?? 15
      return clampInt(r, 1, 100)
    })()

    const mobileOnly = parseBool(searchParams.get('mobile'))
    const openNowOnly = parseBool(searchParams.get('openNow'))
    const minRating = pickNumber(searchParams.get('minRating'))
    const maxPrice = pickNumber(searchParams.get('maxPrice'))
    const sort = normalizeSort(searchParams.get('sort'))

    if (tab === 'SERVICES') {
      const services = await prisma.service.findMany({
        where: q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                {
                  category: {
                    name: { contains: q, mode: 'insensitive' },
                  },
                },
              ],
            }
          : undefined,
        take: 40,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          category: {
            select: { name: true },
          },
        },
      })

      return jsonOk({
        ok: true,
        pros: [],
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          categoryName: service.category?.name ?? null,
        })),
      })
    }

    const geoEnabled = lat != null && lng != null
    const origin =
      geoEnabled && lat != null && lng != null ? { lat, lng } : null

    const matchedProfessions = q
      ? inferProfessionTypesFromQuery(q)
      : []

    const pros = await prisma.professionalProfile.findMany({
      where: {
        verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
        ...(q
          ? {
              OR: [
                { businessName: { contains: q, mode: 'insensitive' } },
                { handle: { contains: q, mode: 'insensitive' } },
                { location: { contains: q, mode: 'insensitive' } },
                ...(matchedProfessions.length > 0
                  ? [{ professionType: { in: matchedProfessions } }]
                  : []),
              ],
            }
          : {}),
      },
      take: 200,
      orderBy: [{ businessName: 'asc' }, { handleNormalized: 'asc' }],
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

    const ratingRows = await prisma.review.groupBy({
      by: ['professionalId'],
      where: { professionalId: { in: proIds } },
      _avg: { rating: true },
      _count: { _all: true },
    })

    const ratingByPro = new Map<
      string,
      { avg: number | null; count: number }
    >()

    for (const row of ratingRows) {
      ratingByPro.set(row.professionalId, {
        avg:
          typeof row._avg.rating === 'number' ? row._avg.rating : null,
        count: row._count._all ?? 0,
      })
    }

    const offeringRows =
      await prisma.professionalServiceOffering.findMany({
        where: {
          professionalId: { in: proIds },
          isActive: true,
        },
        select: {
          professionalId: true,
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
        },
      })

    const offerByPro = new Map<
      string,
      {
        supportsSalon: boolean
        supportsMobile: boolean
        minSalon: number | null
        minMobile: number | null
        minAny: number | null
      }
    >()

    for (const offering of offeringRows) {
      const current = offerByPro.get(offering.professionalId) ?? {
        supportsSalon: false,
        supportsMobile: false,
        minSalon: null,
        minMobile: null,
        minAny: null,
      }

      const salonPrice = decToNum(offering.salonPriceStartingAt)
      const mobilePrice = decToNum(offering.mobilePriceStartingAt)

      if (offering.offersInSalon) current.supportsSalon = true
      if (offering.offersMobile) current.supportsMobile = true

      if (offering.offersInSalon && salonPrice != null) {
        current.minSalon =
          current.minSalon == null
            ? salonPrice
            : Math.min(current.minSalon, salonPrice)
      }

      if (offering.offersMobile && mobilePrice != null) {
        current.minMobile =
          current.minMobile == null
            ? mobilePrice
            : Math.min(current.minMobile, mobilePrice)
      }

      const candidates = [current.minSalon, current.minMobile].filter(
        (value): value is number => typeof value === 'number',
      )

      current.minAny =
        candidates.length > 0 ? Math.min(...candidates) : null

      offerByPro.set(offering.professionalId, current)
    }

    const mapLocation = (
      location: (typeof pros)[number]['locations'][number],
    ): DiscoveryLocationDto =>
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
      })

        const base = pros.map((pro) => {
      const locs = (pro.locations ?? [])
        .map(mapLocation)
        .filter(
          (location) =>
            location.lat != null && location.lng != null,
        )

      const primary = pickPrimaryLocation(locs)
      const fallback = primary ?? locs[0] ?? null

      const rating = ratingByPro.get(pro.id) ?? {
        avg: null,
        count: 0,
      }

      const offers = offerByPro.get(pro.id) ?? {
        supportsSalon: false,
        supportsMobile: false,
        minSalon: null,
        minMobile: null,
        minAny: null,
      }

      return {
        pro,
        locs,
        primary,
        fallback,
        rating,
        offers,
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
              radiusMiles,
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
        
    let filtered = results

    if (mobileOnly) {
      filtered = filtered.filter(
        (entry) => entry.offers.supportsMobile,
      )
    }

    if (maxPrice != null) {
      filtered = filtered.filter((entry) => {
        const price = mobileOnly
          ? entry.offers.minMobile
          : entry.offers.minAny

        return price != null && price <= maxPrice
      })
    }

    if (minRating != null) {
      filtered = filtered.filter(
        (entry) =>
          entry.rating.avg != null && entry.rating.avg >= minRating,
      )
    }

    if (openNowOnly) {
      filtered = filtered.filter((entry) => {
        const loc = entry.closest
        if (!loc) return false

        return isOpenNowAtLocation({
          timeZone: loc.timeZone,
          workingHours: loc.workingHours,
        })
      })
    }

    filtered = filtered.sort((a, b) => {
      if (sort === 'NAME') {
        const aName = (a.pro.businessName ?? '').toLowerCase()
        const bName = (b.pro.businessName ?? '').toLowerCase()
        return aName.localeCompare(bName)
      }

      if (sort === 'RATING') {
        const aRating = a.rating.avg ?? -1
        const bRating = b.rating.avg ?? -1

        if (bRating !== aRating) return bRating - aRating
        return (b.rating.count ?? 0) - (a.rating.count ?? 0)
      }

      if (sort === 'PRICE') {
        const aPrice = mobileOnly
          ? a.offers.minMobile ?? Number.POSITIVE_INFINITY
          : a.offers.minAny ?? Number.POSITIVE_INFINITY

        const bPrice = mobileOnly
          ? b.offers.minMobile ?? Number.POSITIVE_INFINITY
          : b.offers.minAny ?? Number.POSITIVE_INFINITY

        return aPrice - bPrice
      }

      const aDistance = a.dist ?? Number.POSITIVE_INFINITY
      const bDistance = b.dist ?? Number.POSITIVE_INFINITY
      return aDistance - bDistance
    })

    return jsonOk({
      ok: true,
      pros: filtered.slice(0, 50).map((entry) => {
        const loc = entry.closest

        return {
          id: entry.pro.id,
          businessName: entry.pro.businessName ?? null,
          handle: entry.pro.handle ?? null,
          professionType: entry.pro.professionType ?? null,
          avatarUrl: entry.pro.avatarUrl ?? null,
          locationLabel: buildDiscoveryLocationLabel({
            profileLocation: entry.pro.location ?? null,
            location: loc ?? entry.primary ?? null,
          }),
          distanceMiles: entry.dist,
          ratingAvg: entry.rating.avg,
          ratingCount: entry.rating.count,
          minPrice: mobileOnly
            ? entry.offers.minMobile
            : entry.offers.minAny,
          supportsMobile: entry.offers.supportsMobile,
          closestLocation: loc ?? null,
          primaryLocation: entry.primary ?? null,
        }
      }),
      services: [],
    })
  } catch (e) {
    console.error('GET /api/search error', e)
    return jsonFail(500, 'Failed to search.')
  }
}