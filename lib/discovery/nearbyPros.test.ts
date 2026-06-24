// lib/discovery/nearbyPros.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ProfessionType } from '@prisma/client'

import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'
import { rootTenantContext, whiteLabelTenantContext } from '@/lib/tenant/context'

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

  return {
    prisma,
    isRuntimeFlagEnabled: vi.fn(),
    fetchProSearchCandidates: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/runtimeFlags', () => ({
  isRuntimeFlagEnabled: mocks.isRuntimeFlagEnabled,
}))

vi.mock('@/lib/search/pros', () => ({
  fetchProSearchCandidates: mocks.fetchProSearchCandidates,
}))

import { loadNearbyPros, toPublicNearbyProCard } from './nearbyPros'
import type { NearbyProCard } from './nearbyPros'

const DEFAULT_WORKING_HOURS = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
}

const ROOT_CONTEXT = rootTenantContext('tenant_root')
const SALON_CONTEXT = whiteLabelTenantContext({
  tenantId: 'tenant_salon_a',
  slug: 'salon-a',
})

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

// Builds a ProSearchCandidate (the shape returned by the mocked
// fetchProSearchCandidates) for the search-index path tests.
function makeCandidate(args: {
  professionalId: string
  distanceMiles: number | null
  closestLocationId: string
  primaryLocationId?: string
  minAnyPrice?: number | null
  offersMobile?: boolean
  ratingAvg?: number | null
  ratingCount?: number | bigint
  businessName?: string | null
}) {
  const closest = {
    id: args.closestLocationId,
    formattedAddress: '1 Closest St',
    city: 'San Diego',
    state: 'CA',
    timeZone: 'America/Los_Angeles',
    placeId: `place_${args.closestLocationId}`,
    lat: 32.7,
    lng: -117.1,
    isPrimary: args.primaryLocationId == null,
    workingHours: DEFAULT_WORKING_HOURS,
  }

  const primary =
    args.primaryLocationId == null
      ? closest
      : {
          ...closest,
          id: args.primaryLocationId,
          formattedAddress: '2 Primary Ave',
          isPrimary: true,
        }

  return {
    row: {
      professionalId: args.professionalId,
      businessName: args.businessName ?? 'TOVIS Studio',
      handle: 'tovisstudio',
      professionType: ProfessionType.BARBER,
      avatarUrl: null,
      locationId: args.closestLocationId,
      formattedAddress: closest.formattedAddress,
      city: closest.city,
      state: closest.state,
      timeZone: closest.timeZone,
      placeId: closest.placeId,
      lat: closest.lat,
      lng: closest.lng,
      isPrimary: closest.isPrimary,
      workingHours: closest.workingHours,
      ratingAvg: args.ratingAvg ?? null,
      ratingCount: args.ratingCount ?? 0,
      offersMobile: args.offersMobile ?? false,
      minMobilePrice: null,
      minAnyPrice: args.minAnyPrice ?? null,
      distanceMiles: args.distanceMiles,
    },
    closest,
    primary,
  }
}

describe('lib/discovery/nearbyPros.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.professionalLocation.findMany.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
    mocks.prisma.review.groupBy.mockResolvedValue([])
    // Default to the legacy bounding-box path; the search-index suite opts in.
    mocks.isRuntimeFlagEnabled.mockResolvedValue(false)
    mocks.fetchProSearchCandidates.mockResolvedValue([])
  })

  it('queries only primary, bookable, publicly approved locations and excludes the provided professional id', async () => {
    await loadNearbyPros(
      {
        lat: 32.7157,
        lng: -117.1611,
        radiusMiles: 15,
        categoryId: null,
        serviceId: null,
        excludeProfessionalId: 'pro_self',
        limit: 20,
      },
      ROOT_CONTEXT,
    )

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

  it('scopes white-label nearby discovery to professionals in the request tenant', async () => {
    await loadNearbyPros(
      {
        lat: 32.7157,
        lng: -117.1611,
        radiusMiles: 15,
        categoryId: null,
        serviceId: null,
        excludeProfessionalId: null,
        limit: 20,
      },
      SALON_CONTEXT,
    )

    expect(mocks.prisma.professionalLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professional: expect.objectContaining({
            homeTenantId: 'tenant_salon_a',
            verificationStatus: { in: [...PUBLICLY_APPROVED_PRO_STATUSES] },
          }),
        }),
      }),
    )
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

    const result = await loadNearbyPros(
      {
        lat: 32.7157,
        lng: -117.1611,
        radiusMiles: 15,
        categoryId: 'cat_hair',
        serviceId: null,
        excludeProfessionalId: null,
        limit: 20,
      },
      ROOT_CONTEXT,
    )

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

    const result = await loadNearbyPros(
      {
        lat: 32.7157,
        lng: -117.1611,
        radiusMiles: 15,
        categoryId: null,
        serviceId: 'svc_target',
        excludeProfessionalId: 'pro_self',
        limit: 20,
      },
      ROOT_CONTEXT,
    )

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

  describe('search-index path (nearby_search_index_enabled)', () => {
    beforeEach(() => {
      mocks.isRuntimeFlagEnabled.mockResolvedValue(true)
    })

    it('delegates to the shared candidate query with DISTANCE sort + nearby filters and skips the legacy query', async () => {
      mocks.fetchProSearchCandidates.mockResolvedValue([])

      await loadNearbyPros(
        {
          lat: 32.7157,
          lng: -117.1611,
          radiusMiles: 15,
          categoryId: 'cat_hair',
          serviceId: 'svc_balayage',
          excludeProfessionalId: 'pro_self',
          limit: 20,
        },
        SALON_CONTEXT,
      )

      expect(mocks.isRuntimeFlagEnabled).toHaveBeenCalledWith(
        'nearby_search_index_enabled',
      )
      expect(mocks.fetchProSearchCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          lat: 32.7157,
          lng: -117.1611,
          radiusMiles: 15,
          categoryId: 'cat_hair',
          serviceId: 'svc_balayage',
          excludeProfessionalId: 'pro_self',
          sort: 'DISTANCE',
          mobileOnly: false,
          openNowOnly: false,
          limit: 20,
        }),
        SALON_CONTEXT,
      )
      // The bounding-box path must not run when the flag is on.
      expect(mocks.prisma.professionalLocation.findMany).not.toHaveBeenCalled()
      expect(mocks.prisma.review.groupBy).not.toHaveBeenCalled()
    })

    it('maps candidates to cards using the closest location and denormalized rollups', async () => {
      mocks.fetchProSearchCandidates.mockResolvedValue([
        makeCandidate({
          professionalId: 'pro_2',
          distanceMiles: 3.456,
          closestLocationId: 'loc_closest',
          primaryLocationId: 'loc_primary',
          minAnyPrice: 120,
          offersMobile: true,
          ratingAvg: 4.7,
          ratingCount: BigInt(9),
        }),
      ])

      const result = await loadNearbyPros(
        {
          lat: 32.7,
          lng: -117.1,
          radiusMiles: 15,
          categoryId: null,
          serviceId: null,
          excludeProfessionalId: null,
          limit: 20,
        },
        ROOT_CONTEXT,
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'pro_2',
        distanceMiles: 3.5, // rounded to 1 dp
        minPrice: 120, // minAnyPrice (mobileOnly false)
        supportsMobile: true,
        ratingAvg: 4.7,
        ratingCount: 9, // bigint -> number
      })
      // Closest vs primary are distinct (the intentional semantics change).
      expect(result[0]?.closestLocation.id).toBe('loc_closest')
      expect(result[0]?.primaryLocation.id).toBe('loc_primary')
      // workingHours preserved on the embedded location DTO (contract parity).
      expect(result[0]?.closestLocation).toHaveProperty('workingHours')
    })

    it('honors the caller limit and drops candidates with a non-finite distance', async () => {
      mocks.fetchProSearchCandidates.mockResolvedValue([
        makeCandidate({
          professionalId: 'pro_a',
          distanceMiles: 1,
          closestLocationId: 'la',
        }),
        makeCandidate({
          professionalId: 'pro_nodist',
          distanceMiles: null,
          closestLocationId: 'lnd',
        }),
        makeCandidate({
          professionalId: 'pro_b',
          distanceMiles: 2,
          closestLocationId: 'lb',
        }),
        makeCandidate({
          professionalId: 'pro_c',
          distanceMiles: 3,
          closestLocationId: 'lc',
        }),
      ])

      const result = await loadNearbyPros(
        {
          lat: 32.7,
          lng: -117.1,
          radiusMiles: 15,
          categoryId: null,
          serviceId: null,
          excludeProfessionalId: null,
          limit: 2,
        },
        ROOT_CONTEXT,
      )

      // pro_nodist dropped (null distance); limit slices the rest to 2.
      expect(result.map((card) => card.id)).toEqual(['pro_a', 'pro_b'])
    })
  })
})

describe('toPublicNearbyProCard', () => {
  function makeCard(): NearbyProCard {
    const location = {
      id: 'loc_1',
      formattedAddress: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'OR',
      timeZone: 'America/Los_Angeles',
      placeId: 'place_home',
      lat: 44.0462123,
      lng: -123.0220456,
      isPrimary: true,
      workingHours: {},
    }

    return {
      id: 'pro_1',
      businessName: 'Home Studio',
      handle: 'homestudio',
      professionType: null,
      avatarUrl: null,
      locationLabel: 'Springfield, OR',
      distanceMiles: 1.4,
      ratingAvg: 5,
      ratingCount: 3,
      minPrice: 60,
      supportsMobile: true,
      closestLocation: { ...location },
      primaryLocation: { ...location },
    }
  }

  it('strips exact address + placeId and coarsens coordinates on both locations', () => {
    const publicCard = toPublicNearbyProCard(makeCard())

    for (const loc of [publicCard.closestLocation, publicCard.primaryLocation]) {
      expect(loc.formattedAddress).toBeNull()
      expect(loc.placeId).toBeNull()
      // Rooftop precision removed — coarsened to a ~1.1km (2-decimal) grid.
      expect(loc.lat).toBe(44.05)
      expect(loc.lng).toBe(-123.02)
      // Non-sensitive coarse fields are preserved.
      expect(loc.city).toBe('Springfield')
      expect(loc.state).toBe('OR')
    }

    // Distance is computed upstream from exact coords and is left untouched.
    expect(publicCard.distanceMiles).toBe(1.4)
  })

  it('passes null coordinates through unchanged', () => {
    const card = makeCard()
    card.closestLocation.lat = null
    card.closestLocation.lng = null

    const publicCard = toPublicNearbyProCard(card)

    expect(publicCard.closestLocation.lat).toBeNull()
    expect(publicCard.closestLocation.lng).toBeNull()
  })
})
