// lib/discovery/nearbyPros.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ProfessionType } from '@prisma/client'

import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'

const mocks = vi.hoisted(() => {
  const prisma = {
    professionalLocation: {
      findMany: vi.fn(),
    },
    professionalServiceOffering: {
      findMany: vi.fn(),
    },
    review: {
      groupBy: vi.fn(),
    },
  }

  return { prisma }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { loadNearbyPros } from './nearbyPros'

const DEFAULT_WORKING_HOURS = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
}

function makeLocationRow(args: {
  locationId: string
  professionalId: string
  lat: string
  lng: string
  businessName?: string | null
  handle?: string | null
  professionType?: ProfessionType | null
  profileLocation?: string | null
  city?: string | null
  state?: string | null
}) {
  return {
    id: args.locationId,
    professionalId: args.professionalId,
    formattedAddress: '123 Main St',
    city: args.city ?? 'San Diego',
    state: args.state ?? 'CA',
    timeZone: 'America/Los_Angeles',
    placeId: `place_${args.locationId}`,
    lat: new Prisma.Decimal(args.lat),
    lng: new Prisma.Decimal(args.lng),
    isPrimary: true,
    workingHours: DEFAULT_WORKING_HOURS,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    professional: {
      id: args.professionalId,
      businessName: args.businessName ?? 'TOVIS Studio',
      handle: args.handle ?? 'tovisstudio',
      professionType: args.professionType ?? ProfessionType.BARBER,
      avatarUrl: null,
      location: args.profileLocation ?? 'San Diego, CA',
    },
  }
}

function makeOfferingRow(args: {
  professionalId: string
  serviceId: string
  categoryId: string
  salonPriceStartingAt?: string | null
  mobilePriceStartingAt?: string | null
  offersInSalon?: boolean
  offersMobile?: boolean
}) {
  return {
    professionalId: args.professionalId,
    offersInSalon: args.offersInSalon ?? true,
    offersMobile: args.offersMobile ?? false,
    salonPriceStartingAt:
      args.salonPriceStartingAt == null
        ? null
        : new Prisma.Decimal(args.salonPriceStartingAt),
    mobilePriceStartingAt:
      args.mobilePriceStartingAt == null
        ? null
        : new Prisma.Decimal(args.mobilePriceStartingAt),
    service: {
      id: args.serviceId,
      categoryId: args.categoryId,
    },
  }
}

function makeRatingRow(args: {
  professionalId: string
  avg: number
  count: number
}) {
  return {
    professionalId: args.professionalId,
    _avg: { rating: args.avg },
    _count: { _all: args.count },
  }
}

describe('lib/discovery/nearbyPros.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.professionalLocation.findMany.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
    mocks.prisma.review.groupBy.mockResolvedValue([])
  })

  it('queries only primary, bookable, publicly approved locations and excludes the provided professional id', async () => {
    await loadNearbyPros({
      lat: 32.7157,
      lng: -117.1611,
      radiusMiles: 15,
      categoryId: null,
      serviceId: null,
      excludeProfessionalId: 'pro_self',
      limit: 20,
    })

    expect(mocks.prisma.professionalLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isPrimary: true,
          isBookable: true,
          professionalId: { not: 'pro_self' },
          professional: {
            verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
          },
        }),
        take: 800,
      }),
    )

    expect(mocks.prisma.review.groupBy).not.toHaveBeenCalled()
    expect(mocks.prisma.professionalServiceOffering.findMany).not.toHaveBeenCalled()
  })

  it('returns stable nearby cards ordered by distance and filtered by category', async () => {
    mocks.prisma.professionalLocation.findMany.mockResolvedValue([
      makeLocationRow({
        locationId: 'loc_1',
        professionalId: 'pro_1',
        lat: '32.7157000',
        lng: '-117.1611000',
        businessName: 'Alpha Hair',
        handle: 'alphahair',
      }),
      makeLocationRow({
        locationId: 'loc_2',
        professionalId: 'pro_2',
        lat: '32.7157000',
        lng: '-117.1711000',
        businessName: 'Bravo Hair',
        handle: 'bravohair',
      }),
      makeLocationRow({
        locationId: 'loc_3',
        professionalId: 'pro_3',
        lat: '32.7157000',
        lng: '-117.1621000',
        businessName: 'Makeup Only',
        handle: 'makeuponly',
      }),
    ])

    mocks.prisma.review.groupBy.mockResolvedValue([
      makeRatingRow({ professionalId: 'pro_1', avg: 4.9, count: 12 }),
      makeRatingRow({ professionalId: 'pro_2', avg: 4.7, count: 9 }),
      makeRatingRow({ professionalId: 'pro_3', avg: 4.8, count: 11 }),
    ])

    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      makeOfferingRow({
        professionalId: 'pro_1',
        serviceId: 'svc_cut',
        categoryId: 'cat_hair',
        salonPriceStartingAt: '85.00',
      }),
      makeOfferingRow({
        professionalId: 'pro_2',
        serviceId: 'svc_color',
        categoryId: 'cat_hair',
        salonPriceStartingAt: '95.00',
      }),
      makeOfferingRow({
        professionalId: 'pro_3',
        serviceId: 'svc_makeup',
        categoryId: 'cat_makeup',
        salonPriceStartingAt: '120.00',
      }),
    ])

    const result = await loadNearbyPros({
      lat: 32.7157,
      lng: -117.1611,
      radiusMiles: 15,
      categoryId: 'cat_hair',
      serviceId: null,
      excludeProfessionalId: null,
      limit: 20,
    })

    expect(result.map((row) => row.id)).toEqual(['pro_1', 'pro_2'])

    expect(result[0]).toMatchObject({
      id: 'pro_1',
      businessName: 'Alpha Hair',
      handle: 'alphahair',
      locationLabel: 'San Diego, CA',
      ratingAvg: 4.9,
      ratingCount: 12,
      minPrice: 85,
      supportsMobile: false,
    })

    expect(result[0]?.distanceMiles).toBe(0)
    expect(result[1]?.distanceMiles).toBeGreaterThan(result[0]?.distanceMiles ?? -1)
    expect(result[0]?.closestLocation.id).toBe('loc_1')
    expect(result[0]?.primaryLocation.id).toBe('loc_1')
  })

  it('uses exact serviceId matching, preserves miles in the DTO, and queries offerings by the canonical service id', async () => {
    mocks.prisma.professionalLocation.findMany.mockResolvedValue([
      makeLocationRow({
        locationId: 'loc_2',
        professionalId: 'pro_2',
        lat: '32.7157000',
        lng: '-117.1661000',
        businessName: 'Bravo Hair',
        handle: 'bravohair',
      }),
    ])

    mocks.prisma.review.groupBy.mockResolvedValue([
      makeRatingRow({ professionalId: 'pro_2', avg: 4.7, count: 9 }),
    ])

    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
      makeOfferingRow({
        professionalId: 'pro_2',
        serviceId: 'svc_target',
        categoryId: 'cat_hair',
        salonPriceStartingAt: '120.00',
        offersMobile: true,
        mobilePriceStartingAt: '150.00',
      }),
    ])

    const result = await loadNearbyPros({
      lat: 32.7157,
      lng: -117.1611,
      radiusMiles: 15,
      categoryId: null,
      serviceId: 'svc_target',
      excludeProfessionalId: 'pro_self',
      limit: 20,
    })

    expect(mocks.prisma.professionalServiceOffering.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professionalId: { in: ['pro_2'] },
          isActive: true,
          service: expect.objectContaining({
            isActive: true,
            id: 'svc_target',
          }),
        }),
      }),
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'pro_2',
      minPrice: 120,
      supportsMobile: true,
      ratingAvg: 4.7,
      ratingCount: 9,
    })
    expect(typeof result[0]?.distanceMiles).toBe('number')
  })
})