// app/api/v1/availability/bootstrap/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getScheduleVersion: vi.fn(),
  getScheduleConfigVersion: vi.fn(),

  professionalLocationFindMany: vi.fn(),

  buildSummaryCacheKey: vi.fn(),
  withVersionedCache: vi.fn(),

  resolveDurationWithAddOns: vi.fn(),
  loadBusyIntervals: vi.fn(),
  loadAvailabilityOfferingContext: vi.fn(),
  loadOtherProsNearbyCached: vi.fn(),

  computeDaySlotsFast: vi.fn(),
  resolveTenantContextForRequest: vi.fn(),
  tenantCacheScope: vi.fn(),
  tenantContext: {
    isRoot: false,
    tenantId: 'tenant_salon_a',
    slug: 'salon-a',
  },
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  getScheduleVersion: mocks.getScheduleVersion,
  getScheduleConfigVersion: mocks.getScheduleConfigVersion,
}))

vi.mock('@/lib/prisma', () => ({
  prismaRead: {
    professionalLocation: {
      findMany: mocks.professionalLocationFindMany,
    },
  },
}))

vi.mock('@/lib/availability/data/cache', () => ({
  buildSummaryCacheKey: mocks.buildSummaryCacheKey,
}))

vi.mock('@/lib/cache/versionedCache', () => ({
  withVersionedCache: mocks.withVersionedCache,
}))

vi.mock('@/lib/availability/data/addOnContext', () => ({
  resolveDurationWithAddOns: mocks.resolveDurationWithAddOns,
}))

vi.mock('@/lib/availability/data/busyIntervals', () => ({
  loadBusyIntervals: mocks.loadBusyIntervals,
}))

vi.mock('@/lib/availability/data/offeringContext', async () => {
  const actual =
    await vi.importActual<
      typeof import('@/lib/availability/data/offeringContext')
    >('@/lib/availability/data/offeringContext')

  return {
    ...actual,
    loadAvailabilityOfferingContext: mocks.loadAvailabilityOfferingContext,
  }
})

vi.mock('@/lib/availability/data/otherPros', () => ({
  loadOtherProsNearbyCached: mocks.loadOtherProsNearbyCached,
}))

vi.mock('@/lib/availability/core/dayComputation', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/availability/core/dayComputation')>(
      '@/lib/availability/core/dayComputation',
    )

  return {
    ...actual,
    computeDaySlotsFast: mocks.computeDaySlotsFast,
  }
})

vi.mock('@/lib/tenant', () => ({
  resolveTenantContextForRequest: mocks.resolveTenantContextForRequest,
  tenantCacheScope: mocks.tenantCacheScope,
}))

import { GET } from './route'

function makeBaseContext() {
  return {
    ok: true as const,
    value: {
      locationId: 'salon-1',
      effectiveLocationType: ServiceLocationType.SALON,
      timeZone: 'UTC',
      timeZoneSource: 'LOCATION' as const,
      workingHours: {
        sun: { enabled: true, start: '09:00', end: '17:00' },
        mon: { enabled: true, start: '09:00', end: '17:00' },
        tue: { enabled: true, start: '09:00', end: '17:00' },
        wed: { enabled: true, start: '09:00', end: '17:00' },
        thu: { enabled: true, start: '09:00', end: '17:00' },
        fri: { enabled: true, start: '09:00', end: '17:00' },
        sat: { enabled: true, start: '09:00', end: '17:00' },
      },
      defaultStepMinutes: 60,
      defaultLead: 0,
      locationBufferMinutes: 0,
      maxAdvanceDays: 30,
      durationMinutes: 60,
      placementLat: 40.7,
      placementLng: -73.9,
      proBusinessName: 'Pro 1',
      proAvatarUrl: null,
      proLocation: 'NYC',
      serviceName: 'Cut',
      serviceCategoryName: 'Hair',
      offeringDbId: 'offering-1',
      offeringPayload: {
        id: 'offering-1',
        offersInSalon: true,
        offersMobile: false,
        salonDurationMinutes: 60,
        mobileDurationMinutes: null,
        salonPriceStartingAt: '50.00',
        mobilePriceStartingAt: null,
      },
    },
  }
}

async function getBootstrap(params: Record<string, string>) {
  const search = new URLSearchParams(params)
  const req = new Request(
    `https://example.test/api/v1/availability/bootstrap?${search.toString()}`,
  )
  return GET(req)
}

describe('GET /api/v1/availability/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getScheduleVersion.mockResolvedValue(7)
    mocks.getScheduleConfigVersion.mockResolvedValue(3)
    mocks.buildSummaryCacheKey.mockReturnValue('summary-extra')
    mocks.withVersionedCache.mockImplementation(async (_key, loader) => ({
      value: await loader(),
      cacheHit: false,
    }))
    mocks.resolveDurationWithAddOns.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
    })
    mocks.loadBusyIntervals.mockResolvedValue([])
    mocks.loadOtherProsNearbyCached.mockResolvedValue([])
    mocks.professionalLocationFindMany.mockResolvedValue([])
    mocks.loadAvailabilityOfferingContext.mockResolvedValue(makeBaseContext())
    mocks.resolveTenantContextForRequest.mockResolvedValue(mocks.tenantContext)
    mocks.tenantCacheScope.mockReturnValue('tenant:tenant_salon_a')
    mocks.computeDaySlotsFast.mockResolvedValue({
      ok: true,
      dayStartUtc: new Date('2030-01-01T00:00:00.000Z'),
      dayEndExclusiveUtc: new Date('2030-01-02T00:00:00.000Z'),
      slots: ['2030-01-01T09:00:00.000Z', '2030-01-01T10:00:00.000Z'],
    })
  })

  it('cache miss: runs the loader and returns the freshly computed payload', async () => {
    const response = await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('BOOTSTRAP')
    expect(body.professionalId).toBe('pro-1')
    expect(body.locationType).toBe('SALON')
    expect(mocks.withVersionedCache).toHaveBeenCalledTimes(1)
    expect(mocks.computeDaySlotsFast).toHaveBeenCalled()
    expect(mocks.buildSummaryCacheKey).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantScope: 'tenant:tenant_salon_a',
      }),
    )
    expect(mocks.loadOtherProsNearbyCached).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantContext: mocks.tenantContext,
      }),
    )
  })

  it('returns bookable salon location options for salon mode', async () => {
    mocks.professionalLocationFindMany.mockResolvedValue([
      {
        id: 'salon-1',
        type: 'SALON',
        name: 'Downtown Studio',
        city: 'New York',
        state: 'NY',
        formattedAddress: '1 Main St, New York, NY',
        isPrimary: true,
      },
      {
        id: 'suite-1',
        type: 'SUITE',
        name: null,
        city: 'Brooklyn',
        state: 'NY',
        formattedAddress: '2 Side St, Brooklyn, NY',
        isPrimary: false,
      },
    ])

    const response = await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.locationOptions).toEqual([
      expect.objectContaining({ id: 'salon-1', isPrimary: true }),
      expect.objectContaining({ id: 'suite-1', type: 'SUITE' }),
    ])

    expect(mocks.professionalLocationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professionalId: 'pro-1',
          isBookable: true,
        }),
      }),
    )
  })

  it('cache hit: short-circuits the compute and returns the cached payload', async () => {
    const cached = {
      ok: true,
      mode: 'BOOTSTRAP',
      availabilityVersion: 'av:cached',
      generatedAt: '2030-01-01T00:00:00.000Z',
      request: {
        professionalId: 'pro-1',
        serviceId: 'service-1',
        offeringId: 'offering-1',
        locationType: 'SALON',
        locationId: 'salon-1',
        clientAddressId: null,
        addOnIds: [],
        durationMinutes: 60,
      },
      mediaId: null,
      serviceId: 'service-1',
      professionalId: 'pro-1',
      serviceName: 'Cut',
      serviceCategoryName: 'Hair',
      locationType: 'SALON',
      locationId: 'salon-1',
      timeZone: 'UTC',
      timeZoneSource: 'LOCATION',
      stepMinutes: 60,
      leadTimeMinutes: 0,
      locationBufferMinutes: 0,
      adjacencyBufferMinutes: 0,
      maxDaysAhead: 30,
      durationMinutes: 60,
      windowStartDate: '2030-01-01',
      windowEndDate: '2030-01-15',
      nextStartDate: null,
      hasMoreDays: false,
      primaryPro: {
        id: 'pro-1',
        businessName: 'Pro 1',
        avatarUrl: null,
        location: 'NYC',
        offeringId: 'offering-1',
        isCreator: true,
        timeZone: 'UTC',
        timeZoneSource: 'LOCATION',
        locationId: 'salon-1',
      },
      availableDays: [{ date: '2030-01-01', slotCount: 3 }],
      selectedDay: {
        date: '2030-01-01',
        slots: ['2030-01-01T09:00:00.000Z'],
      },
      otherPros: [],
      waitlistSupported: true,
      offering: {
        id: 'offering-1',
        offersInSalon: true,
        offersMobile: false,
        salonDurationMinutes: 60,
        mobileDurationMinutes: null,
        salonPriceStartingAt: '50.00',
        mobilePriceStartingAt: null,
      },
    }

    mocks.withVersionedCache.mockResolvedValueOnce({
      value: cached,
      cacheHit: true,
    })

    const response = await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      mediaId: 'media-xyz',
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.availabilityVersion).toBe('av:cached')
    expect(body.mediaId).toBe('media-xyz') // refreshed per-request
    expect(mocks.computeDaySlotsFast).not.toHaveBeenCalled()
    expect(mocks.loadBusyIntervals).not.toHaveBeenCalled()
  })

  it('passes scheduleConfigVersion as version + buildSummaryCacheKey output as extra', async () => {
    mocks.getScheduleConfigVersion.mockResolvedValue(42)
    mocks.buildSummaryCacheKey.mockReturnValue('hashed-extra-1')

    await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
    })

    expect(mocks.withVersionedCache).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'availability:bootstrap',
        scopeId: 'pro-1',
        version: 42,
        extra: 'hashed-extra-1',
      }),
      expect.any(Function),
      120,
    )
  })

  it('skips the cache entirely in debug mode', async () => {
    await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      debug: '1',
    })

    expect(mocks.withVersionedCache).not.toHaveBeenCalled()
    expect(mocks.buildSummaryCacheKey).not.toHaveBeenCalled()
  })

  it('returns 422 on add-on validation failure (loader never runs)', async () => {
    mocks.resolveDurationWithAddOns.mockResolvedValueOnce({
      ok: false,
      code: 'ADDONS_INVALID',
    })

    const response = await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      addOnIds: 'addon-bad',
    })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(mocks.withVersionedCache).not.toHaveBeenCalled()
  })
})
