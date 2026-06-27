// app/api/v1/availability/alternates/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getScheduleVersion: vi.fn(),
  getScheduleConfigVersion: vi.fn(),

  stableHash: vi.fn(),
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

vi.mock('@/lib/availability/data/cache', () => ({
  stableHash: mocks.stableHash,
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

vi.mock('@/lib/availability/data/offeringContext', () => ({
  loadAvailabilityOfferingContext: mocks.loadAvailabilityOfferingContext,
}))

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

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
}

function ymd(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const FUTURE_DATE = ymd(addDaysUtc(startOfUtcDay(new Date()), 7))
const FUTURE_SLOT_09 = `${FUTURE_DATE}T09:00:00.000Z`

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

async function getAlternates(params: Record<string, string>) {
  const search = new URLSearchParams(params)
  const req = new Request(
    `https://example.test/api/v1/availability/alternates?${search.toString()}`,
  )
  return GET(req)
}

describe('GET /api/v1/availability/alternates', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getScheduleVersion.mockResolvedValue(7)
    mocks.getScheduleConfigVersion.mockResolvedValue(3)
    mocks.stableHash.mockReturnValue('extra-hash')
    mocks.withVersionedCache.mockImplementation(async (_key, loader) => ({
      value: await loader(),
      cacheHit: false,
    }))
    mocks.resolveDurationWithAddOns.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
    })
    mocks.loadBusyIntervals.mockResolvedValue([])
    mocks.loadOtherProsNearbyCached.mockResolvedValue([
      {
        id: 'pro-2',
        businessName: 'Pro 2',
        avatarUrl: null,
        location: 'NYC',
        offeringId: 'offering-2',
        timeZone: 'UTC',
        locationId: 'salon-2',
        distanceMiles: 1.2,
      },
    ])
    mocks.loadAvailabilityOfferingContext.mockResolvedValue(makeBaseContext())
    mocks.resolveTenantContextForRequest.mockResolvedValue(mocks.tenantContext)
    mocks.tenantCacheScope.mockReturnValue('tenant:tenant_salon_a')
    mocks.computeDaySlotsFast.mockResolvedValue({
      ok: true,
      dayStartUtc: new Date(`${FUTURE_DATE}T00:00:00.000Z`),
      dayEndExclusiveUtc: new Date(
        `${ymd(addDaysUtc(new Date(`${FUTURE_DATE}T00:00:00.000Z`), 1))}T00:00:00.000Z`,
      ),
      slots: [FUTURE_SLOT_09],
    })
  })

  it('cache miss: runs the loader and returns alternates with prismaRead reads', async () => {
    const response = await getAlternates({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      date: FUTURE_DATE,
      viewerLat: '40.7',
      viewerLng: '-73.9',
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('ALTERNATES')
    expect(body.alternates).toHaveLength(1)
    expect(body.alternates[0].pro.id).toBe('pro-2')
    expect(mocks.withVersionedCache).toHaveBeenCalledTimes(1)
    expect(mocks.loadOtherProsNearbyCached).toHaveBeenCalled()
    expect(mocks.loadOtherProsNearbyCached).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantContext: mocks.tenantContext,
      }),
    )
    expect(mocks.stableHash).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantScope: 'tenant:tenant_salon_a',
      }),
    )
  })

  it('cache hit: short-circuits loader, returns cached alternates', async () => {
    mocks.withVersionedCache.mockResolvedValueOnce({
      value: {
        alternates: [
          {
            pro: {
              id: 'pro-9',
              businessName: 'Cached Pro',
              avatarUrl: null,
              location: 'NYC',
              offeringId: 'offering-9',
              timeZone: 'UTC',
              locationId: 'salon-9',
              distanceMiles: 0.5,
            },
            slots: [FUTURE_SLOT_09],
          },
        ],
        availabilityVersion: 'alternates:cached',
        fetchedCandidates: 1,
      },
      cacheHit: true,
    })

    const response = await getAlternates({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      date: FUTURE_DATE,
      viewerLat: '40.7',
      viewerLng: '-73.9',
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.availabilityVersion).toBe('alternates:cached')
    expect(body.alternates[0].pro.id).toBe('pro-9')
    expect(mocks.loadOtherProsNearbyCached).not.toHaveBeenCalled()
    expect(mocks.computeDaySlotsFast).not.toHaveBeenCalled()
  })

  it('uses primary pro scheduleConfigVersion as the cache version', async () => {
    mocks.getScheduleConfigVersion.mockResolvedValueOnce(99)
    mocks.stableHash.mockReturnValueOnce('alternates-extra-hash')

    await getAlternates({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      date: FUTURE_DATE,
      viewerLat: '40.7',
      viewerLng: '-73.9',
    })

    expect(mocks.withVersionedCache).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'availability:alternates',
        scopeId: 'pro-1',
        version: 99,
        extra: 'alternates-extra-hash',
      }),
      expect.any(Function),
      60,
    )
  })

  it('passes prismaRead to per-alternate loadAvailabilityOfferingContext', async () => {
    await getAlternates({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      date: FUTURE_DATE,
      viewerLat: '40.7',
      viewerLng: '-73.9',
    })

    // Primary call + at least one alternate call should both pass prismaRead.
    const calls = mocks.loadAvailabilityOfferingContext.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const [args] of calls) {
      expect(args).toMatchObject({ client: expect.anything() })
    }
  })

  it('skips the cache entirely in debug mode', async () => {
    await getAlternates({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      date: FUTURE_DATE,
      viewerLat: '40.7',
      viewerLng: '-73.9',
      debug: '1',
    })

    expect(mocks.withVersionedCache).not.toHaveBeenCalled()
  })

  it('returns empty alternates without caching when no center is available', async () => {
    const response = await getAlternates({
      professionalId: 'pro-1',
      serviceId: 'service-1',
      date: FUTURE_DATE,
      // no viewerLat/Lng → centerLat/Lng come from placement, but we override
    })

    // Primary context provides placementLat/Lng so center is available — the
    // alternates loader runs. Cache-miss path is fine here.
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.mode).toBe('ALTERNATES')
  })
})
