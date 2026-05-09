// lib/search/index/refreshSearchIndex.test.ts
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  locationFindUnique: vi.fn(),
  locationFindMany: vi.fn(),
  offeringFindMany: vi.fn(),
  reviewGroupBy: vi.fn(),
  indexDeleteMany: vi.fn(),
  executeRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalLocation: {
      findUnique: mocks.locationFindUnique,
      findMany: mocks.locationFindMany,
    },
    professionalServiceOffering: {
      findMany: mocks.offeringFindMany,
    },
    review: {
      groupBy: mocks.reviewGroupBy,
    },
    professionalSearchIndex: {
      deleteMany: mocks.indexDeleteMany,
    },
    $executeRaw: mocks.executeRaw,
  },
}))

import {
  deleteLocationFromIndex,
  refreshLocation,
  refreshProfessional,
} from './refreshSearchIndex'

const proSnapshot = {
  id: 'pro_a',
  verificationStatus: 'APPROVED',
  professionType: 'HAIR_STYLIST',
  businessName: 'Vivid Salon',
  handle: 'vivid',
  handleNormalized: 'vivid',
  avatarUrl: 'https://cdn/img.png',
  mobileRadiusMiles: 12,
}

const baseLocation = {
  id: 'loc_a',
  professionalId: 'pro_a',
  type: 'SALON',
  isPrimary: true,
  isBookable: true,
  city: 'San Diego',
  state: 'CA',
  formattedAddress: '123 Main St, San Diego, CA',
  timeZone: 'America/Los_Angeles',
  lat: new Prisma.Decimal('32.7157'),
  lng: new Prisma.Decimal('-117.1611'),
  workingHours: { mon: { enabled: true, start: '09:00', end: '17:00' } },
  professional: proSnapshot,
}

function defaultOfferings() {
  return [
    {
      professionalId: 'pro_a',
      offersInSalon: true,
      offersMobile: false,
      salonPriceStartingAt: new Prisma.Decimal('45.00'),
      mobilePriceStartingAt: null,
      service: { id: 'svc_haircut', categoryId: 'cat_hair' },
    },
    {
      professionalId: 'pro_a',
      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: new Prisma.Decimal('60.00'),
      mobilePriceStartingAt: new Prisma.Decimal('80.00'),
      service: { id: 'svc_color', categoryId: 'cat_color' },
    },
  ]
}

function defaultRatings() {
  return [
    {
      professionalId: 'pro_a',
      _avg: { rating: 4.6 },
      _count: { _all: 23 },
    },
  ]
}

function silenceConsoleError() {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset()
  }
  mocks.executeRaw.mockResolvedValue(1)
  mocks.indexDeleteMany.mockResolvedValue({ count: 0 })
})

describe('refreshLocation', () => {
  it('upserts an index row with all denormalized fields when the location is bookable and geo-valid', async () => {
    mocks.locationFindUnique.mockResolvedValue(baseLocation)
    mocks.offeringFindMany.mockResolvedValue(defaultOfferings())
    mocks.reviewGroupBy.mockResolvedValue(defaultRatings())

    await refreshLocation('loc_a', 'location.create')

    expect(mocks.indexDeleteMany).not.toHaveBeenCalled()
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)

    const [strings, ...values] = mocks.executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ]
    expect(strings.join('?')).toContain('INSERT INTO "ProfessionalSearchIndex"')
    expect(strings.join('?')).toContain('ST_SetSRID(ST_MakePoint(')
    expect(strings.join('?')).toContain('ON CONFLICT ("locationId") DO UPDATE SET')

    // Spot-check that critical denormalized fields are passed positionally.
    expect(values).toContain('loc_a')
    expect(values).toContain('pro_a')
    expect(values).toContain(-117.1611)
    expect(values).toContain(32.7157)
    expect(values).toContain('APPROVED')
    expect(values).toContain('SALON')
    expect(values).toContain('Vivid Salon')
    expect(values).toContain(true) // isBookable

    // categoryIds + serviceIds — deterministic order, distinct.
    expect(values).toContainEqual(['cat_hair', 'cat_color'])
    expect(values).toContainEqual(['svc_haircut', 'svc_color'])

    // Rating + price rollups computed from the offerings/reviews.
    expect(values).toContain(4.6) // ratingAvg
    expect(values).toContain(23)  // ratingCount
    expect(values).toContain(45)  // minSalonPrice
    expect(values).toContain(80)  // minMobilePrice
    expect(values).toContain(45)  // minAnyPrice (Math.min of the two)

    // refreshSource passed through.
    expect(values).toContain('location.create')
  })

  it('deletes the index row when the location is not bookable', async () => {
    mocks.locationFindUnique.mockResolvedValue({
      ...baseLocation,
      isBookable: false,
    })

    await refreshLocation('loc_a', 'location.update')

    expect(mocks.indexDeleteMany).toHaveBeenCalledWith({
      where: { locationId: 'loc_a' },
    })
    expect(mocks.executeRaw).not.toHaveBeenCalled()
    expect(mocks.offeringFindMany).not.toHaveBeenCalled()
  })

  it('deletes the index row when lat/lng are null', async () => {
    mocks.locationFindUnique.mockResolvedValue({
      ...baseLocation,
      lat: null,
      lng: null,
    })

    await refreshLocation('loc_a', 'location.update')

    expect(mocks.indexDeleteMany).toHaveBeenCalledWith({
      where: { locationId: 'loc_a' },
    })
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it('deletes the index row when the location no longer exists', async () => {
    mocks.locationFindUnique.mockResolvedValue(null)

    await refreshLocation('loc_a', 'location.delete')

    expect(mocks.indexDeleteMany).toHaveBeenCalledWith({
      where: { locationId: 'loc_a' },
    })
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it('keeps a row for a pending-verification pro (read-side filter is applied at query time)', async () => {
    mocks.locationFindUnique.mockResolvedValue({
      ...baseLocation,
      professional: { ...proSnapshot, verificationStatus: 'PENDING' },
    })
    mocks.offeringFindMany.mockResolvedValue([])
    mocks.reviewGroupBy.mockResolvedValue([])

    await refreshLocation('loc_a', 'location.create')

    expect(mocks.indexDeleteMany).not.toHaveBeenCalled()
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
    const [, ...values] = mocks.executeRaw.mock.calls[0] as [unknown, ...unknown[]]
    expect(values).toContain('PENDING')
  })

  it('writes empty array rollups when the pro has no active offerings or reviews', async () => {
    mocks.locationFindUnique.mockResolvedValue(baseLocation)
    mocks.offeringFindMany.mockResolvedValue([])
    mocks.reviewGroupBy.mockResolvedValue([])

    await refreshLocation('loc_a', 'location.create')

    const [, ...values] = mocks.executeRaw.mock.calls[0] as [unknown, ...unknown[]]
    expect(values).toContainEqual([])      // categoryIds (empty)
    expect(values).toContain(false)        // offersInSalon (no active offerings)
    expect(values).toContain(0)            // ratingCount
    // ratingAvg / minSalonPrice / minMobilePrice / minAnyPrice all null —
    // verified via at least one null in the bound values.
    expect(values).toContain(null)
  })

  it('swallows refresh errors so a failed index write never blocks the underlying mutation', async () => {
    mocks.locationFindUnique.mockResolvedValue(baseLocation)
    mocks.offeringFindMany.mockResolvedValue(defaultOfferings())
    mocks.reviewGroupBy.mockResolvedValue(defaultRatings())
    mocks.executeRaw.mockRejectedValue(new Error('postgres exploded'))
    const errorSpy = silenceConsoleError()

    await expect(refreshLocation('loc_a', 'location.create')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledOnce()
  })
})

describe('refreshProfessional', () => {
  it('purges every index row for the pro when no qualifying locations remain', async () => {
    mocks.locationFindMany.mockResolvedValue([])

    await refreshProfessional('pro_a', 'workingHours.update')

    expect(mocks.indexDeleteMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_a' },
    })
    expect(mocks.executeRaw).not.toHaveBeenCalled()
    expect(mocks.offeringFindMany).not.toHaveBeenCalled()
  })

  it('drops stale rows by id-not-in then upserts the current set', async () => {
    mocks.locationFindMany.mockResolvedValue([
      baseLocation,
      {
        ...baseLocation,
        id: 'loc_b',
        isPrimary: false,
        type: 'MOBILE_BASE',
      },
    ])
    mocks.offeringFindMany.mockResolvedValue(defaultOfferings())
    mocks.reviewGroupBy.mockResolvedValue(defaultRatings())

    await refreshProfessional('pro_a', 'offering.update')

    // Stale row purge — must filter by professionalId AND notIn current ids.
    expect(mocks.indexDeleteMany).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_a',
        locationId: { notIn: ['loc_a', 'loc_b'] },
      },
    })

    // Pro-level rollups computed exactly once even with multiple locations.
    expect(mocks.offeringFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.reviewGroupBy).toHaveBeenCalledTimes(1)

    // One upsert per qualifying location.
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2)
  })

  it('skips locations whose lat/lng got nulled between the findMany predicate and the iteration', async () => {
    // Defensive — the where clause already filters null lat/lng, but the
    // helper double-checks so an in-flight mutation can't slip through.
    mocks.locationFindMany.mockResolvedValue([
      baseLocation,
      { ...baseLocation, id: 'loc_b', lat: null, lng: null },
    ])
    mocks.offeringFindMany.mockResolvedValue(defaultOfferings())
    mocks.reviewGroupBy.mockResolvedValue(defaultRatings())

    await refreshProfessional('pro_a', 'workingHours.update')

    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
  })

  it('swallows refresh errors so the underlying mutation is never reverted', async () => {
    mocks.locationFindMany.mockRejectedValue(new Error('replica unreachable'))
    const errorSpy = silenceConsoleError()

    await expect(refreshProfessional('pro_a', 'offering.create')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledOnce()
  })
})

describe('deleteLocationFromIndex', () => {
  it('issues a deleteMany scoped to the locationId', async () => {
    await deleteLocationFromIndex('loc_a')

    expect(mocks.indexDeleteMany).toHaveBeenCalledWith({
      where: { locationId: 'loc_a' },
    })
  })

  it('swallows errors and logs them', async () => {
    mocks.indexDeleteMany.mockRejectedValue(new Error('connection lost'))
    const errorSpy = silenceConsoleError()

    await expect(deleteLocationFromIndex('loc_a')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledOnce()
  })
})
