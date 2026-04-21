// lib/search/pros.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ProfessionType } from '@prisma/client'

import { SearchRequestError, encodeIdCursor } from './contracts'

const mocks = vi.hoisted(() => {
  const prisma = {
    professionalProfile: {
      findMany: vi.fn(),
    },
    review: {
      groupBy: vi.fn(),
    },
    professionalServiceOffering: {
      findMany: vi.fn(),
    },
  }

  const inferProfessionTypesFromQuery = vi.fn(
    (query: string): ProfessionType[] => {
      const q = query.trim().toLowerCase()
      const hits: ProfessionType[] = []

      if (q.includes('barber')) hits.push(ProfessionType.BARBER)
      if (
        q.includes('cosmo') ||
        q.includes('hair') ||
        q.includes('stylist')
      ) {
        hits.push(ProfessionType.COSMETOLOGIST)
      }
      if (
        q.includes('esthetic') ||
        q.includes('facial') ||
        q.includes('skin')
      ) {
        hits.push(ProfessionType.ESTHETICIAN)
      }
      if (
        q.includes('nail') ||
        q.includes('mani') ||
        q.includes('pedi')
      ) {
        hits.push(ProfessionType.MANICURIST)
      }
      if (q.includes('massage')) {
        hits.push(ProfessionType.MASSAGE_THERAPIST)
      }
      if (q.includes('makeup') || q.includes('mua')) {
        hits.push(ProfessionType.MAKEUP_ARTIST)
      }

      return Array.from(new Set(hits))
    },
  )

  const mapProfessionalLocation = vi.fn((input) => ({
    id: input.id,
    formattedAddress: input.formattedAddress ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    timeZone: input.timeZone ?? null,
    placeId: input.placeId ?? null,
    lat:
      typeof input.lat === 'number'
        ? input.lat
        : input.lat == null
          ? null
          : Number(input.lat),
    lng:
      typeof input.lng === 'number'
        ? input.lng
        : input.lng == null
          ? null
          : Number(input.lng),
    isPrimary: Boolean(input.isPrimary),
    workingHours: input.workingHours,
  }))

  const pickPrimaryLocation = vi.fn((locations) => {
    return (
      locations.find((location: { isPrimary: boolean }) => location.isPrimary) ??
      locations[0] ??
      null
    )
  })

  const pickClosestLocationWithinRadius = vi.fn(
    ({
      locations,
    }: {
      origin: { lat: number; lng: number }
      locations: Array<{
        lat: number | null
        lng: number | null
      }>
      radiusMiles: number
    }) => {
      const first = locations[0] ?? null
      if (!first) return null

      return {
        location: first,
        distanceMiles: 1.2,
      }
    },
  )

  const isOpenNowAtLocation = vi.fn(() => true)

  const buildDiscoveryLocationLabel = vi.fn(
    ({
      profileLocation,
      location,
    }: {
      profileLocation: string | null
      location: { city: string | null; state: string | null } | null
    }) => {
      const profile = profileLocation?.trim() ?? ''
      if (profile) return profile

      const city = location?.city?.trim() ?? ''
      const state = location?.state?.trim() ?? ''

      if (city && state) return `${city}, ${state}`
      if (city) return city
      if (state) return state

      return null
    },
  )

  function decToNum(value: unknown): number | null {
    if (value == null) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string') {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      'toString' in value &&
      typeof value.toString === 'function'
    ) {
      const n = Number(value.toString())
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  const buildDiscoveryOfferSummaryMap = vi.fn((offerings) => {
    const byPro = new Map<
      string,
      {
        professionalId: string
        supportsSalon: boolean
        supportsMobile: boolean
        minSalon: number | null
        minMobile: number | null
        minAny: number | null
        categoryIds: string[]
      }
    >()

    for (const offering of offerings as Array<{
      professionalId: string
      offersInSalon: boolean
      offersMobile: boolean
      salonPriceStartingAt: unknown
      mobilePriceStartingAt: unknown
      categoryId: string | null
    }>) {
      const current = byPro.get(offering.professionalId) ?? {
        professionalId: offering.professionalId,
        supportsSalon: false,
        supportsMobile: false,
        minSalon: null,
        minMobile: null,
        minAny: null,
        categoryIds: [],
      }

      const salonPrice = decToNum(offering.salonPriceStartingAt)
      const mobilePrice = decToNum(offering.mobilePriceStartingAt)

      if (offering.offersInSalon) {
        current.supportsSalon = true
        current.minSalon =
          current.minSalon == null ||
          (salonPrice != null && salonPrice < current.minSalon)
            ? salonPrice
            : current.minSalon
      }

      if (offering.offersMobile) {
        current.supportsMobile = true
        current.minMobile =
          current.minMobile == null ||
          (mobilePrice != null && mobilePrice < current.minMobile)
            ? mobilePrice
            : current.minMobile
      }

      if (
        typeof offering.categoryId === 'string' &&
        offering.categoryId.trim() &&
        !current.categoryIds.includes(offering.categoryId)
      ) {
        current.categoryIds.push(offering.categoryId)
      }

      const prices = [current.minSalon, current.minMobile].filter(
        (value): value is number => value != null,
      )
      current.minAny = prices.length > 0 ? Math.min(...prices) : null

      byPro.set(offering.professionalId, current)
    }

    return byPro
  })

  const matchesDiscoveryOfferingFilters = vi.fn(
    ({
      offerSummary,
      mobileOnly,
      requestedCategoryId,
    }: {
      offerSummary: {
        supportsMobile: boolean
        categoryIds: string[]
      }
      mobileOnly?: boolean | null
      requestedCategoryId?: string | null
    }) => {
      if (mobileOnly && !offerSummary.supportsMobile) {
        return false
      }

      if (requestedCategoryId) {
        return offerSummary.categoryIds.includes(requestedCategoryId)
      }

      return true
    },
  )

  const PUBLICLY_APPROVED_PRO_STATUSES = ['APPROVED'] as const

  return {
    prisma,
    inferProfessionTypesFromQuery,
    mapProfessionalLocation,
    pickPrimaryLocation,
    pickClosestLocationWithinRadius,
    isOpenNowAtLocation,
    buildDiscoveryLocationLabel,
    buildDiscoveryOfferSummaryMap,
    matchesDiscoveryOfferingFilters,
    PUBLICLY_APPROVED_PRO_STATUSES,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/proTrustState', () => ({
  PUBLICLY_APPROVED_PRO_STATUSES: mocks.PUBLICLY_APPROVED_PRO_STATUSES,
}))

vi.mock('@/lib/discovery/nearby', () => ({
  buildDiscoveryLocationLabel: mocks.buildDiscoveryLocationLabel,
  buildDiscoveryOfferSummaryMap: mocks.buildDiscoveryOfferSummaryMap,
  inferProfessionTypesFromQuery: mocks.inferProfessionTypesFromQuery,
  isOpenNowAtLocation: mocks.isOpenNowAtLocation,
  mapProfessionalLocation: mocks.mapProfessionalLocation,
  matchesDiscoveryOfferingFilters: mocks.matchesDiscoveryOfferingFilters,
  pickClosestLocationWithinRadius: mocks.pickClosestLocationWithinRadius,
  pickPrimaryLocation: mocks.pickPrimaryLocation,
}))

import { parseSearchProsParams, searchPros } from './pros'

const DEFAULT_LOCATION = {
  id: 'loc_primary',
  formattedAddress: '123 Main St',
  city: 'San Diego',
  state: 'CA',
  timeZone: 'America/Los_Angeles',
  placeId: 'place_1',
  lat: 32.7157,
  lng: -117.1611,
  isPrimary: true,
  workingHours: {
    mon: { enabled: true, start: '09:00', end: '17:00' },
  },
}

function makeSearchablePro(overrides?: {
  id?: string
  businessName?: string
  handle?: string
  professionType?: ProfessionType
  avatarUrl?: string | null
  location?: string | null
  locations?: Array<typeof DEFAULT_LOCATION>
}) {
  return {
    id: overrides?.id ?? 'pro_1',
    businessName: overrides?.businessName ?? 'TOVIS Studio',
    handle: overrides?.handle ?? 'tovisstudio',
    professionType: overrides?.professionType ?? ProfessionType.BARBER,
    avatarUrl: overrides?.avatarUrl ?? null,
    location: overrides?.location ?? 'San Diego, CA',
    locations: overrides?.locations ?? [DEFAULT_LOCATION],
  }
}

function makeRatingRow(overrides?: {
  professionalId?: string
  avg?: number
  count?: number
}) {
  return {
    professionalId: overrides?.professionalId ?? 'pro_1',
    _avg: { rating: overrides?.avg ?? 4.8 },
    _count: { _all: overrides?.count ?? 12 },
  }
}

function makeOfferingRow(overrides?: {
  professionalId?: string
  offersInSalon?: boolean
  offersMobile?: boolean
  salonPriceStartingAt?: Prisma.Decimal | null
  mobilePriceStartingAt?: Prisma.Decimal | null
  categoryId?: string | null
}) {
  return {
    professionalId: overrides?.professionalId ?? 'pro_1',
    offersInSalon: overrides?.offersInSalon ?? true,
    offersMobile: overrides?.offersMobile ?? false,
    salonPriceStartingAt:
      overrides?.salonPriceStartingAt ?? new Prisma.Decimal('85.00'),
    mobilePriceStartingAt: overrides?.mobilePriceStartingAt ?? null,
    service: {
      categoryId: overrides?.categoryId ?? 'cat_hair',
    },
  }
}

describe('lib/search/pros.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.prisma.professionalProfile.findMany.mockResolvedValue([])
    mocks.prisma.review.groupBy.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
  })

  describe('parseSearchProsParams', () => {
    it('parses defaults for the stable pros contract', () => {
      const params = parseSearchProsParams(new URLSearchParams('q=barber'))

      expect(params).toEqual({
        q: 'barber',
        lat: null,
        lng: null,
        categoryId: null,
        radiusMiles: 15,
        mobileOnly: false,
        openNowOnly: false,
        minRating: null,
        maxPrice: null,
        sort: 'DISTANCE',
        cursorId: null,
        limit: 50,
      })
    })

    it('decodes a valid cursor and clamps limit/radius', () => {
      const cursor = encodeIdCursor('pro_2')

      const params = parseSearchProsParams(
        new URLSearchParams(
          `cursor=${encodeURIComponent(cursor)}&limit=999&radiusMiles=200&mobile=true&openNow=yes&sort=name&lat=32.7&lng=-117.1`,
        ),
      )

      expect(params).toEqual({
        q: null,
        lat: 32.7,
        lng: -117.1,
        categoryId: null,
        radiusMiles: 100,
        mobileOnly: true,
        openNowOnly: true,
        minRating: null,
        maxPrice: null,
        sort: 'NAME',
        cursorId: 'pro_2',
        limit: 50,
      })
    })

    it('throws a 400 SearchRequestError for an invalid cursor', () => {
      expect(() =>
        parseSearchProsParams(
          new URLSearchParams('cursor=definitely-not-valid'),
        ),
      ).toThrowError(SearchRequestError)

      try {
        parseSearchProsParams(
          new URLSearchParams('cursor=definitely-not-valid'),
        )
        throw new Error('expected parseSearchProsParams to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(SearchRequestError)
        expect((error as SearchRequestError).status).toBe(400)
        expect((error as SearchRequestError).message).toBe(
          'Invalid pros search cursor.',
        )
      }
    })
  })

  describe('searchPros', () => {
    it('queries only publicly approved pros and only bookable locations', async () => {
      await searchPros({
        q: 'barber',
        lat: null,
        lng: null,
        categoryId: null,
        radiusMiles: 15,
        mobileOnly: false,
        openNowOnly: false,
        minRating: null,
        maxPrice: null,
        sort: 'DISTANCE',
        cursorId: null,
        limit: 50,
      })

      expect(mocks.inferProfessionTypesFromQuery).toHaveBeenCalledWith('barber')

      expect(mocks.prisma.professionalProfile.findMany).toHaveBeenCalledWith({
        where: {
          verificationStatus: {
            in: [...mocks.PUBLICLY_APPROVED_PRO_STATUSES],
          },
          OR: [
            { businessName: { contains: 'barber', mode: 'insensitive' } },
            { handle: { contains: 'barber', mode: 'insensitive' } },
            { location: { contains: 'barber', mode: 'insensitive' } },
            { professionType: { in: [ProfessionType.BARBER] } },
          ],
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

      expect(mocks.prisma.review.groupBy).not.toHaveBeenCalled()
      expect(mocks.prisma.professionalServiceOffering.findMany).not.toHaveBeenCalled()
    })

    it('returns the stable DTO shape with canonical pro ids and strips workingHours from location previews', async () => {
      mocks.prisma.professionalProfile.findMany.mockResolvedValue([
        makeSearchablePro({
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          handle: 'tovisstudio',
          professionType: ProfessionType.MAKEUP_ARTIST,
        }),
      ])

      mocks.prisma.review.groupBy.mockResolvedValue([
        makeRatingRow({
          professionalId: 'pro_1',
          avg: 4.8,
          count: 12,
        }),
      ])

      mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
        makeOfferingRow({
          professionalId: 'pro_1',
          offersInSalon: true,
          offersMobile: false,
          salonPriceStartingAt: new Prisma.Decimal('85.00'),
          categoryId: 'cat_makeup',
        }),
      ])

      const result = await searchPros({
        q: null,
        lat: null,
        lng: null,
        categoryId: null,
        radiusMiles: 15,
        mobileOnly: false,
        openNowOnly: false,
        minRating: null,
        maxPrice: null,
        sort: 'DISTANCE',
        cursorId: null,
        limit: 50,
      })

      expect(result).toEqual({
        items: [
          {
            id: 'pro_1',
            businessName: 'TOVIS Studio',
            handle: 'tovisstudio',
            professionType: ProfessionType.MAKEUP_ARTIST,
            avatarUrl: null,
            locationLabel: 'San Diego, CA',
            distanceMiles: null,
            ratingAvg: 4.8,
            ratingCount: 12,
            minPrice: 85,
            supportsMobile: false,
            closestLocation: {
              id: 'loc_primary',
              formattedAddress: '123 Main St',
              city: 'San Diego',
              state: 'CA',
              timeZone: 'America/Los_Angeles',
              placeId: 'place_1',
              lat: 32.7157,
              lng: -117.1611,
              isPrimary: true,
            },
            primaryLocation: {
              id: 'loc_primary',
              formattedAddress: '123 Main St',
              city: 'San Diego',
              state: 'CA',
              timeZone: 'America/Los_Angeles',
              placeId: 'place_1',
              lat: 32.7157,
              lng: -117.1611,
              isPrimary: true,
            },
          },
        ],
        nextCursor: null,
      })

      expect(result.items[0]?.id).toBe('pro_1')
      expect(result.items[0]?.closestLocation).not.toHaveProperty('workingHours')
      expect(result.items[0]?.primaryLocation).not.toHaveProperty('workingHours')
    })

    it('filters pros through the shared discovery offering/category helper', async () => {
      mocks.prisma.professionalProfile.findMany.mockResolvedValue([
        makeSearchablePro({
          id: 'pro_1',
          businessName: 'Hair One',
          handle: 'hairone',
        }),
        makeSearchablePro({
          id: 'pro_2',
          businessName: 'Hair Two',
          handle: 'hairtwo',
        }),
      ])

      mocks.prisma.review.groupBy.mockResolvedValue([
        makeRatingRow({ professionalId: 'pro_1', avg: 4.7, count: 9 }),
        makeRatingRow({ professionalId: 'pro_2', avg: 4.6, count: 8 }),
      ])

      mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
        makeOfferingRow({
          professionalId: 'pro_1',
          categoryId: 'cat_hair',
          offersMobile: true,
          mobilePriceStartingAt: new Prisma.Decimal('95.00'),
        }),
        makeOfferingRow({
          professionalId: 'pro_2',
          categoryId: 'cat_makeup',
          offersMobile: true,
          mobilePriceStartingAt: new Prisma.Decimal('110.00'),
        }),
      ])

      const result = await searchPros({
        q: null,
        lat: 32.7,
        lng: -117.1,
        categoryId: 'cat_hair',
        radiusMiles: 15,
        mobileOnly: true,
        openNowOnly: false,
        minRating: null,
        maxPrice: null,
        sort: 'DISTANCE',
        cursorId: null,
        limit: 50,
      })

      expect(mocks.matchesDiscoveryOfferingFilters).toHaveBeenCalledTimes(2)
      expect(mocks.matchesDiscoveryOfferingFilters).toHaveBeenNthCalledWith(1, {
        offerSummary: {
          professionalId: 'pro_1',
          supportsSalon: true,
          supportsMobile: true,
          minSalon: 85,
          minMobile: 95,
          minAny: 85,
          categoryIds: ['cat_hair'],
        },
        mobileOnly: true,
        requestedCategoryId: 'cat_hair',
      })

      expect(mocks.matchesDiscoveryOfferingFilters).toHaveBeenNthCalledWith(2, {
        offerSummary: {
          professionalId: 'pro_2',
          supportsSalon: true,
          supportsMobile: true,
          minSalon: 85,
          minMobile: 110,
          minAny: 85,
          categoryIds: ['cat_makeup'],
        },
        mobileOnly: true,
        requestedCategoryId: 'cat_hair',
      })

      expect(result.items.map((item) => item.id)).toEqual(['pro_1'])
      expect(result.nextCursor).toBeNull()
    })

    it('supports cursor pagination over the final sorted results', async () => {
      mocks.prisma.professionalProfile.findMany.mockResolvedValue([
        makeSearchablePro({
          id: 'pro_1',
          businessName: 'Alpha Studio',
          handle: 'alpha',
        }),
        makeSearchablePro({
          id: 'pro_2',
          businessName: 'Bravo Studio',
          handle: 'bravo',
        }),
        makeSearchablePro({
          id: 'pro_3',
          businessName: 'Charlie Studio',
          handle: 'charlie',
        }),
      ])

      mocks.prisma.review.groupBy.mockResolvedValue([
        makeRatingRow({ professionalId: 'pro_1', avg: 4.5, count: 5 }),
        makeRatingRow({ professionalId: 'pro_2', avg: 4.7, count: 6 }),
        makeRatingRow({ professionalId: 'pro_3', avg: 4.9, count: 7 }),
      ])

      mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
        makeOfferingRow({ professionalId: 'pro_1', categoryId: 'cat_hair' }),
        makeOfferingRow({ professionalId: 'pro_2', categoryId: 'cat_hair' }),
        makeOfferingRow({ professionalId: 'pro_3', categoryId: 'cat_hair' }),
      ])

      const page1 = await searchPros({
        q: null,
        lat: null,
        lng: null,
        categoryId: null,
        radiusMiles: 15,
        mobileOnly: false,
        openNowOnly: false,
        minRating: null,
        maxPrice: null,
        sort: 'NAME',
        cursorId: null,
        limit: 1,
      })

      expect(page1.items.map((item) => item.id)).toEqual(['pro_1'])
      expect(page1.nextCursor).toBeTruthy()

      const page2 = await searchPros({
        q: null,
        lat: null,
        lng: null,
        categoryId: null,
        radiusMiles: 15,
        mobileOnly: false,
        openNowOnly: false,
        minRating: null,
        maxPrice: null,
        sort: 'NAME',
        cursorId: 'pro_1',
        limit: 1,
      })

      expect(page2.items.map((item) => item.id)).toEqual(['pro_2'])
      expect(page2.nextCursor).toBe(encodeIdCursor('pro_2'))
    })

    it('applies open-now filtering through the shared location helper', async () => {
      mocks.prisma.professionalProfile.findMany.mockResolvedValue([
        makeSearchablePro({
          id: 'pro_1',
          businessName: 'Open Pro',
        }),
      ])

      mocks.prisma.review.groupBy.mockResolvedValue([
        makeRatingRow({ professionalId: 'pro_1', avg: 4.8, count: 12 }),
      ])

      mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
        makeOfferingRow({ professionalId: 'pro_1', categoryId: 'cat_hair' }),
      ])

      mocks.isOpenNowAtLocation.mockReturnValueOnce(false)

      const result = await searchPros({
        q: null,
        lat: 32.7,
        lng: -117.1,
        categoryId: null,
        radiusMiles: 15,
        mobileOnly: false,
        openNowOnly: true,
        minRating: null,
        maxPrice: null,
        sort: 'DISTANCE',
        cursorId: null,
        limit: 50,
      })

      expect(mocks.isOpenNowAtLocation).toHaveBeenCalledTimes(1)
      expect(result).toEqual({
        items: [],
        nextCursor: null,
      })
    })
  })
})