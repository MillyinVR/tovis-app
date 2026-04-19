// app/api/search/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ProfessionType } from '@prisma/client'

import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn((data: unknown, status = 200) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const jsonFail = vi.fn((status: number, message: string) => {
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  const prisma = {
    service: {
      findMany: vi.fn(),
    },
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
          current.minSalon == null || (salonPrice != null && salonPrice < current.minSalon)
            ? salonPrice
            : current.minSalon
      }

      if (offering.offersMobile) {
        current.supportsMobile = true
        current.minMobile =
          current.minMobile == null || (mobilePrice != null && mobilePrice < current.minMobile)
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

  return {
    jsonOk,
    jsonFail,
    prisma,
    inferProfessionTypesFromQuery,
    mapProfessionalLocation,
    pickPrimaryLocation,
    pickClosestLocationWithinRadius,
    isOpenNowAtLocation,
    buildDiscoveryLocationLabel,
    buildDiscoveryOfferSummaryMap,
    matchesDiscoveryOfferingFilters,
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
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

import { GET } from './route'

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

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`)
}

function makeSearchablePro(overrides?: {
  id?: string
  businessName?: string
  handle?: string
  professionType?: ProfessionType
  avatarUrl?: string | null
  location?: string | null
}) {
  return {
    id: overrides?.id ?? 'pro_1',
    businessName: overrides?.businessName ?? 'TOVIS Studio',
    handle: overrides?.handle ?? 'tovisstudio',
    professionType: overrides?.professionType ?? ProfessionType.BARBER,
    avatarUrl: overrides?.avatarUrl ?? null,
    location: overrides?.location ?? 'San Diego, CA',
    locations: [DEFAULT_LOCATION],
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

describe('app/api/search/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.prisma.service.findMany.mockResolvedValue([])
    mocks.prisma.professionalProfile.findMany.mockResolvedValue([])
    mocks.prisma.review.groupBy.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
  })

  it('returns services for the SERVICES tab and does not query professional discovery', async () => {
    mocks.prisma.service.findMany.mockResolvedValue([
      {
        id: 'svc_1',
        name: 'Silk Press',
        category: {
          id: 'cat_hair',
          name: 'Hair',
          slug: 'hair',
        },
      },
    ])

    const res = await GET(
      makeRequest('/api/search?tab=SERVICES&q=silk&categoryId=cat_hair'),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      pros: [],
      services: [
        {
          id: 'svc_1',
          name: 'Silk Press',
          categoryId: 'cat_hair',
          categoryName: 'Hair',
          categorySlug: 'hair',
        },
      ],
    })

    expect(mocks.prisma.service.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        categoryId: 'cat_hair',
        OR: [
          { name: { contains: 'silk', mode: 'insensitive' } },
          { category: { name: { contains: 'silk', mode: 'insensitive' } } },
        ],
      },
      take: 40,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    })

    expect(mocks.prisma.professionalProfile.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.review.groupBy).not.toHaveBeenCalled()
    expect(mocks.prisma.professionalServiceOffering.findMany).not.toHaveBeenCalled()
  })

  it('queries only publicly approved pros and only bookable locations for discovery', async () => {
    const res = await GET(makeRequest('/api/search?q=barber'))

    expect(res.status).toBe(200)
    expect(mocks.inferProfessionTypesFromQuery).toHaveBeenCalledWith('barber')

    expect(mocks.prisma.professionalProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
          OR: [
            { businessName: { contains: 'barber', mode: 'insensitive' } },
            { handle: { contains: 'barber', mode: 'insensitive' } },
            { location: { contains: 'barber', mode: 'insensitive' } },
            { professionType: { in: [ProfessionType.BARBER] } },
          ],
        },
        take: 200,
        orderBy: [{ businessName: 'asc' }, { handleNormalized: 'asc' }],
        select: expect.objectContaining({
          id: true,
          businessName: true,
          handle: true,
          professionType: true,
          avatarUrl: true,
          location: true,
          locations: expect.objectContaining({
            where: { isBookable: true, lat: { not: null }, lng: { not: null } },
            take: 25,
          }),
        }),
      }),
    )
  })

  it('returns no discovery results before approval and returns the pro after approval when the location is bookable', async () => {
    mocks.prisma.professionalProfile.findMany.mockResolvedValueOnce([])
    mocks.prisma.review.groupBy.mockResolvedValueOnce([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValueOnce([])

    const beforeRes = await GET(makeRequest('/api/search?q=tovis'))
    const beforeBody = await beforeRes.json()

    expect(beforeRes.status).toBe(200)
    expect(beforeBody).toEqual({
      ok: true,
      pros: [],
      services: [],
    })

    mocks.prisma.professionalProfile.findMany.mockResolvedValueOnce([
      makeSearchablePro({
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        handle: 'tovisstudio',
        professionType: ProfessionType.MAKEUP_ARTIST,
      }),
    ])
    mocks.prisma.review.groupBy.mockResolvedValueOnce([
      makeRatingRow({
        professionalId: 'pro_1',
        avg: 4.8,
        count: 12,
      }),
    ])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValueOnce([
      makeOfferingRow({
        professionalId: 'pro_1',
        offersInSalon: true,
        offersMobile: false,
        salonPriceStartingAt: new Prisma.Decimal('85.00'),
        mobilePriceStartingAt: null,
        categoryId: 'cat_makeup',
      }),
    ])

    const afterRes = await GET(makeRequest('/api/search?q=tovis'))
    const afterBody = await afterRes.json()

    expect(afterRes.status).toBe(200)
    expect(afterBody).toEqual({
      ok: true,
      pros: [
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
          closestLocation: DEFAULT_LOCATION,
          primaryLocation: DEFAULT_LOCATION,
        },
      ],
      services: [],
    })

    expect(mocks.prisma.professionalProfile.findMany).toHaveBeenCalledTimes(2)
  })

  it('returns mapped pro discovery results for an approved searchable pro', async () => {
    mocks.prisma.professionalProfile.findMany.mockResolvedValue([
      makeSearchablePro(),
    ])
    mocks.prisma.review.groupBy.mockResolvedValue([makeRatingRow()])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      makeOfferingRow(),
    ])

    const res = await GET(makeRequest('/api/search'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      pros: [
        {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          handle: 'tovisstudio',
          professionType: ProfessionType.BARBER,
          avatarUrl: null,
          locationLabel: 'San Diego, CA',
          distanceMiles: null,
          ratingAvg: 4.8,
          ratingCount: 12,
          minPrice: 85,
          supportsMobile: false,
          closestLocation: DEFAULT_LOCATION,
          primaryLocation: DEFAULT_LOCATION,
        },
      ],
      services: [],
    })

    expect(mocks.buildDiscoveryOfferSummaryMap).toHaveBeenCalledWith([
      {
        professionalId: 'pro_1',
        offersInSalon: true,
        offersMobile: false,
        salonPriceStartingAt: new Prisma.Decimal('85.00'),
        mobilePriceStartingAt: null,
        categoryId: 'cat_hair',
      },
    ])

    expect(mocks.matchesDiscoveryOfferingFilters).toHaveBeenCalledWith({
      offerSummary: {
        professionalId: 'pro_1',
        supportsSalon: true,
        supportsMobile: false,
        minSalon: 85,
        minMobile: null,
        minAny: 85,
        categoryIds: ['cat_hair'],
      },
      mobileOnly: false,
      requestedCategoryId: null,
    })
  })

  it('filters discovery pros through the shared offering/category filter helper', async () => {
    mocks.prisma.professionalProfile.findMany.mockResolvedValue([
      makeSearchablePro({ id: 'pro_1', businessName: 'Hair One' }),
      makeSearchablePro({ id: 'pro_2', businessName: 'Hair Two', handle: 'hairtwo' }),
    ])

    mocks.prisma.review.groupBy.mockResolvedValue([
      makeRatingRow({ professionalId: 'pro_1', avg: 4.7, count: 9 }),
      makeRatingRow({ professionalId: 'pro_2', avg: 4.6, count: 8 }),
    ])

    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      makeOfferingRow({
        professionalId: 'pro_1',
        categoryId: 'cat_hair',
      }),
      makeOfferingRow({
        professionalId: 'pro_2',
        categoryId: 'cat_makeup',
      }),
    ])

    const res = await GET(
      makeRequest('/api/search?categoryId=cat_hair&mobile=true'),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.matchesDiscoveryOfferingFilters).toHaveBeenCalledTimes(2)

    expect(body).toEqual({
      ok: true,
      pros: [],
      services: [],
    })
  })

  it('returns 500 when discovery search throws', async () => {
    mocks.prisma.professionalProfile.findMany.mockRejectedValue(
      new Error('db blew up'),
    )

    const res = await GET(makeRequest('/api/search?q=barber'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Failed to search.',
    })
  })
})