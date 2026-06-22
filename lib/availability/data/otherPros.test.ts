// lib/availability/data/otherPros.test.ts
import {
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rootTenantContext, whiteLabelTenantContext } from '@/lib/tenant/context'

const mocks = vi.hoisted(() => ({
  professionalLocationFindMany: vi.fn(),
  professionalServiceOfferingFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalLocation: {
      findMany: mocks.professionalLocationFindMany,
    },
    professionalServiceOffering: {
      findMany: mocks.professionalServiceOfferingFindMany,
    },
  },
}))

vi.mock('@/lib/proTrustState', () => ({
  PUBLICLY_APPROVED_PRO_STATUSES: ['APPROVED'],
}))

import {
  loadOtherProsNearby,
  loadOtherProsNearbyCached,
} from './otherPros'

const baseLocation = {
  id: 'loc_1',
  professionalId: 'pro_1',
  type: ProfessionalLocationType.SALON,
  timeZone: 'America/Los_Angeles',
  workingHours: {
    mon: { enabled: true, start: '09:00', end: '17:00' },
  },
  lat: new Prisma.Decimal('32.715736'),
  lng: new Prisma.Decimal('-117.161087'),
  city: 'San Diego',
  state: 'CA',
  formattedAddress: '123 Main St, San Diego, CA',
  isPrimary: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const baseOfferingRow = {
  id: 'offering_1',
  professionalId: 'pro_1',
  serviceId: 'service_1',
  offersInSalon: true,
  offersMobile: false,
  salonPriceStartingAt: new Prisma.Decimal('100.00'),
  mobilePriceStartingAt: null,
  professional: {
    id: 'pro_1',
    businessName: 'Vivid Salon',
    handle: 'vivid',
    avatarUrl: null,
    reviewsReceived: [],
  },
}

const ROOT_CONTEXT = rootTenantContext('tenant_root')
const SALON_CONTEXT = whiteLabelTenantContext({
  tenantId: 'tenant_salon_a',
  slug: 'salon-a',
})

describe('loadOtherProsNearby', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.professionalLocationFindMany.mockResolvedValue([])
    mocks.professionalServiceOfferingFindMany.mockResolvedValue([])
  })

  it('queries only bookable, geo-valid, publicly approved pros for salon alternates', async () => {
    await loadOtherProsNearby({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 6,
    })

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledTimes(1)

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isBookable: true,
          professionalId: { not: 'current_pro' },
          type: {
            in: [
              ProfessionalLocationType.SALON,
              ProfessionalLocationType.SUITE,
            ],
          },
          timeZone: { not: null },
          workingHours: { not: Prisma.JsonNull },
          professional: {
            verificationStatus: { in: ['APPROVED'] },
          },
          lat: expect.objectContaining({
            not: null,
          }),
          lng: expect.objectContaining({
            not: null,
          }),
        }),
        take: 800,
      }),
    )
  })

  it('scopes white-label other-pro alternates to professionals in the request tenant', async () => {
    await loadOtherProsNearby({
      tenantContext: SALON_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 6,
    })

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professional: expect.objectContaining({
            homeTenantId: 'tenant_salon_a',
            verificationStatus: { in: ['APPROVED'] },
          }),
        }),
      }),
    )
  })

  it('queries mobile-base locations for mobile alternates', async () => {
    await loadOtherProsNearby({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.MOBILE,
      excludeProfessionalId: 'current_pro',
      limit: 6,
    })

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: {
            in: [ProfessionalLocationType.MOBILE_BASE],
          },
          professional: {
            verificationStatus: { in: ['APPROVED'] },
          },
        }),
      }),
    )
  })

  it('uses the provided read client when supplied', async () => {
    const readClient = {
      professionalLocation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      professionalServiceOffering: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    }

    await loadOtherProsNearby({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 6,
      client: readClient as unknown as Parameters<
        typeof loadOtherProsNearby
      >[0]['client'],
    })

    expect(readClient.professionalLocation.findMany).toHaveBeenCalledTimes(1)
    expect(mocks.professionalLocationFindMany).not.toHaveBeenCalled()
  })

  it('returns an empty list when no candidate locations are found', async () => {
    mocks.professionalLocationFindMany.mockResolvedValueOnce([])

    const result = await loadOtherProsNearby({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 6,
    })

    expect(result).toEqual([])
    expect(mocks.professionalServiceOfferingFindMany).not.toHaveBeenCalled()
  })

  it('filters out the current professional at the query boundary', async () => {
    await loadOtherProsNearby({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 6,
    })

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professionalId: { not: 'current_pro' },
        }),
      }),
    )
  })

  it('does not query unbounded result sets', async () => {
    await loadOtherProsNearby({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 50,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 12,
    })

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 800,
      }),
    )
  })

  it('loads active matching offerings only for candidate professionals', async () => {
    mocks.professionalLocationFindMany.mockResolvedValueOnce([baseLocation])
    mocks.professionalServiceOfferingFindMany.mockResolvedValueOnce([
      baseOfferingRow,
    ])

    await loadOtherProsNearby({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 6,
    })

    expect(mocks.professionalServiceOfferingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professionalId: { in: ['pro_1'] },
          serviceId: 'service_1',
          isActive: true,
          offersInSalon: true,
          salonPriceStartingAt: { not: null },
          salonDurationMinutes: { not: null },
        }),
        select: expect.objectContaining({
          id: true,
          professionalId: true,
          professional: {
            select: {
              id: true,
              businessName: true,
              firstName: true,
              lastName: true,
              handle: true,
              nameDisplay: true,
              avatarUrl: true,
            },
          },
        }),
        take: 2000,
      }),
    )
  })
})

describe('loadOtherProsNearbyCached', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.professionalLocationFindMany.mockResolvedValue([])
    mocks.professionalServiceOfferingFindMany.mockResolvedValue([])
  })

  it('bypasses cached behavior when cacheEnabled is false', async () => {
    await loadOtherProsNearbyCached({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 6,
      cacheEnabled: false,
    })

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledTimes(1)
  })

  it('can load fresh rows through the cached wrapper', async () => {
    mocks.professionalLocationFindMany.mockResolvedValueOnce([baseLocation])
    mocks.professionalServiceOfferingFindMany.mockResolvedValueOnce([
      baseOfferingRow,
    ])

    const result = await loadOtherProsNearbyCached({
      tenantContext: ROOT_CONTEXT,
      centerLat: 32.715736,
      centerLng: -117.161087,
      radiusMiles: 15,
      serviceId: 'service_1',
      locationType: ServiceLocationType.SALON,
      excludeProfessionalId: 'current_pro',
      limit: 6,
      cacheEnabled: false,
    })

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.professionalServiceOfferingFindMany).toHaveBeenCalledTimes(1)
    expect(Array.isArray(result)).toBe(true)
  })
})
