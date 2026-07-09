import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, ServiceLocationType } from '@prisma/client'

import { isBookingError } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  offeringAddOnFindMany: vi.fn(),
  proOfferingFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offeringAddOn: { findMany: mocks.offeringAddOnFindMany },
    professionalServiceOffering: { findMany: mocks.proOfferingFindMany },
  },
}))

import { resolveBookingAddOns } from './addOnResolution'

const PROFESSIONAL_ID = 'pro_1'
const OFFERING_ID = 'offering_1'

function link(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'oa_1',
    addOnServiceId: 'svc_addon_1',
    sortOrder: 3,
    priceOverride: null,
    durationOverrideMinutes: null,
    addOnService: {
      id: 'svc_addon_1',
      defaultDurationMinutes: 30,
      minPrice: new Prisma.Decimal('20'),
    },
    ...(overrides ?? {}),
  }
}

describe('resolveBookingAddOns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.offeringAddOnFindMany.mockResolvedValue([])
    mocks.proOfferingFindMany.mockResolvedValue([])
  })

  it('returns [] and issues no query for an empty selection', async () => {
    const result = await resolveBookingAddOns({
      professionalId: PROFESSIONAL_ID,
      offeringId: OFFERING_ID,
      addOnIds: [],
      locationType: ServiceLocationType.SALON,
    })

    expect(result).toEqual([])
    expect(mocks.offeringAddOnFindMany).not.toHaveBeenCalled()
  })

  it('prefers the link override for price and duration', async () => {
    mocks.offeringAddOnFindMany.mockResolvedValue([
      link({
        priceOverride: new Prisma.Decimal('45'),
        durationOverrideMinutes: 40,
      }),
    ])
    // A pro offering exists but the override wins.
    mocks.proOfferingFindMany.mockResolvedValue([
      {
        serviceId: 'svc_addon_1',
        salonPriceStartingAt: new Prisma.Decimal('99'),
        salonDurationMinutes: 99,
        mobilePriceStartingAt: new Prisma.Decimal('99'),
        mobileDurationMinutes: 99,
      },
    ])

    const [addOn] = await resolveBookingAddOns({
      professionalId: PROFESSIONAL_ID,
      offeringId: OFFERING_ID,
      addOnIds: ['oa_1'],
      locationType: ServiceLocationType.SALON,
    })

    expect(addOn?.offeringAddOnId).toBe('oa_1')
    expect(addOn?.serviceId).toBe('svc_addon_1')
    expect(addOn?.durationMinutesSnapshot).toBe(40)
    expect(addOn?.priceSnapshot.toString()).toBe('45')
    expect(addOn?.sortOrder).toBe(3)
  })

  it('falls back to the pro offering for the requested mode when no override', async () => {
    mocks.offeringAddOnFindMany.mockResolvedValue([link()])
    mocks.proOfferingFindMany.mockResolvedValue([
      {
        serviceId: 'svc_addon_1',
        salonPriceStartingAt: new Prisma.Decimal('30'),
        salonDurationMinutes: 25,
        mobilePriceStartingAt: new Prisma.Decimal('50'),
        mobileDurationMinutes: 60,
      },
    ])

    const [salon] = await resolveBookingAddOns({
      professionalId: PROFESSIONAL_ID,
      offeringId: OFFERING_ID,
      addOnIds: ['oa_1'],
      locationType: ServiceLocationType.SALON,
    })
    expect(salon?.durationMinutesSnapshot).toBe(25)
    expect(salon?.priceSnapshot.toString()).toBe('30')

    const [mobile] = await resolveBookingAddOns({
      professionalId: PROFESSIONAL_ID,
      offeringId: OFFERING_ID,
      addOnIds: ['oa_1'],
      locationType: ServiceLocationType.MOBILE,
    })
    expect(mobile?.durationMinutesSnapshot).toBe(60)
    expect(mobile?.priceSnapshot.toString()).toBe('50')
  })

  it('falls back to the add-on service defaults when the pro has no offering', async () => {
    mocks.offeringAddOnFindMany.mockResolvedValue([link()])
    mocks.proOfferingFindMany.mockResolvedValue([])

    const [addOn] = await resolveBookingAddOns({
      professionalId: PROFESSIONAL_ID,
      offeringId: OFFERING_ID,
      addOnIds: ['oa_1'],
      locationType: ServiceLocationType.SALON,
    })

    expect(addOn?.durationMinutesSnapshot).toBe(30)
    expect(addOn?.priceSnapshot.toString()).toBe('20')
  })

  it('throws ADDONS_INVALID when a requested id does not resolve to a link', async () => {
    // Two ids requested, only one link returned (e.g. inactive / wrong offering).
    mocks.offeringAddOnFindMany.mockResolvedValue([link()])

    await expect(
      resolveBookingAddOns({
        professionalId: PROFESSIONAL_ID,
        offeringId: OFFERING_ID,
        addOnIds: ['oa_1', 'oa_missing'],
        locationType: ServiceLocationType.SALON,
      }),
    ).rejects.toSatisfy(
      (err) => isBookingError(err) && err.code === 'ADDONS_INVALID',
    )
  })

  it('throws ADDONS_INVALID when the resolved duration is not positive', async () => {
    mocks.offeringAddOnFindMany.mockResolvedValue([
      link({
        durationOverrideMinutes: 0,
        addOnService: {
          id: 'svc_addon_1',
          defaultDurationMinutes: null,
          minPrice: new Prisma.Decimal('20'),
        },
      }),
    ])
    mocks.proOfferingFindMany.mockResolvedValue([])

    await expect(
      resolveBookingAddOns({
        professionalId: PROFESSIONAL_ID,
        offeringId: OFFERING_ID,
        addOnIds: ['oa_1'],
        locationType: ServiceLocationType.SALON,
      }),
    ).rejects.toSatisfy(
      (err) => isBookingError(err) && err.code === 'ADDONS_INVALID',
    )
  })
})
