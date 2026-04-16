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

  const getWorkingWindowForDay = vi.fn()

  return {
    jsonOk,
    jsonFail,
    prisma,
    getWorkingWindowForDay,
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

vi.mock('@/lib/scheduling/workingHours', () => ({
  getWorkingWindowForDay: mocks.getWorkingWindowForDay,
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

function makeRequest(path: string) {
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
}) {
  return {
    professionalId: overrides?.professionalId ?? 'pro_1',
    offersInSalon: overrides?.offersInSalon ?? true,
    offersMobile: overrides?.offersMobile ?? false,
    salonPriceStartingAt:
      overrides?.salonPriceStartingAt ?? new Prisma.Decimal('85.00'),
    mobilePriceStartingAt: overrides?.mobilePriceStartingAt ?? null,
  }
}

describe('app/api/search/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getWorkingWindowForDay.mockReturnValue({
      ok: true,
      startMinutes: 9 * 60,
      endMinutes: 17 * 60,
    })

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
        category: { name: 'Hair' },
      },
    ])

    const res = await GET(makeRequest('/api/search?tab=SERVICES&q=silk'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      pros: [],
      services: [
        {
          id: 'svc_1',
          name: 'Silk Press',
          categoryName: 'Hair',
        },
      ],
    })

    expect(mocks.prisma.service.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: 'silk', mode: 'insensitive' } },
          { category: { name: { contains: 'silk', mode: 'insensitive' } } },
        ],
      },
      take: 40,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, category: { select: { name: true } } },
    })

    expect(mocks.prisma.professionalProfile.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.review.groupBy).not.toHaveBeenCalled()
    expect(mocks.prisma.professionalServiceOffering.findMany).not.toHaveBeenCalled()
  })

  it('queries only publicly approved pros and only bookable locations for discovery', async () => {
    const res = await GET(makeRequest('/api/search?q=barber'))

    expect(res.status).toBe(200)

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

    mocks.prisma.review.groupBy.mockResolvedValue([
      makeRatingRow(),
    ])

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