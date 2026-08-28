// app/api/v1/availability/bootstrap/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  getScheduleVersion: vi.fn(),
  getScheduleConfigVersion: vi.fn(),

  professionalLocationFindMany: vi.fn(),
  // The MOBILE service-area lookup ("Travels up to N mi around …"). Both halves
  // are mocked because the route resolves them in EVERY mode, not only mobile —
  // the sheet needs the pro's reach in hand before the client flips the toggle.
  professionalLocationFindFirst: vi.fn(),
  professionalProfileFindUnique: vi.fn(),

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
      findFirst: mocks.professionalLocationFindFirst,
    },
    professionalProfile: {
      findUnique: mocks.professionalProfileFindUnique,
    },
  },
}))

// The route's own concern is routing + caching; what the trust chips and the
// cover resolve TO is `lib/booking/*`'s concern and is tested there. Stubbing
// them here also keeps this suite from needing a Prisma surface it never had.
vi.mock('@/lib/booking/trustSignals', () => ({
  loadBookingTrustSignals: vi.fn(async () => ({
    verified: true,
    completedBookings: 41,
    rating: { average: 4.8, count: 12 },
    freeCancellationHours: 24,
  })),
}))

vi.mock('@/lib/booking/bookingCover', () => ({
  loadBookingCover: vi.fn(async () => ({
    imageUrl: 'https://cdn.example.com/look.jpg',
    lookName: 'Lived-in blonde',
  })),
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
    // A pro who has published neither a travel radius nor a mobile base: the
    // route then omits `serviceArea` rather than sending a half-filled promise,
    // which is the shape every existing assertion here was written against.
    mocks.professionalProfileFindUnique.mockResolvedValue(null)
    mocks.professionalLocationFindFirst.mockResolvedValue(null)
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

  // `waitlistSupported` was a hardcoded `true`, so the drawer offered a salon
  // waitlist panel for a pro with no salon to host it in — and the pro's offer
  // endpoint then refused every joiner. It is now derived from the SAME narrowed
  // offering modes the drawer's In-salon toggle reads.
  describe('waitlistSupported', () => {
    function contextWithModes(modes: {
      offersInSalon: boolean
      offersMobile: boolean
    }) {
      const base = makeBaseContext()
      return {
        ...base,
        value: {
          ...base.value,
          offeringPayload: { ...base.value.offeringPayload, ...modes },
        },
      }
    }

    it('is true for a pro who can actually host the service in-salon', async () => {
      const body = await (
        await getBootstrap({ professionalId: 'pro-1', serviceId: 'service-1' })
      ).json()

      expect(body.waitlistSupported).toBe(true)
    })

    it('is FALSE for a mobile-only pro — a travel waitlist cannot be offered yet', async () => {
      mocks.loadAvailabilityOfferingContext.mockResolvedValue(
        contextWithModes({ offersInSalon: false, offersMobile: true }),
      )

      const body = await (
        await getBootstrap({ professionalId: 'pro-1', serviceId: 'service-1' })
      ).json()

      expect(body.waitlistSupported).toBe(false)
      // The offering itself still reports the mode it really has — only the
      // waitlist claim is withdrawn.
      expect(body.offering.offersMobile).toBe(true)
    })

    it('is FALSE for a pro with no bookable location of any kind', async () => {
      // Both flags narrowed off upstream = nothing hostable anywhere.
      mocks.loadAvailabilityOfferingContext.mockResolvedValue(
        contextWithModes({ offersInSalon: false, offersMobile: false }),
      )

      const body = await (
        await getBootstrap({ professionalId: 'pro-1', serviceId: 'service-1' })
      ).json()

      expect(body.waitlistSupported).toBe(false)
    })
  })

  it('keeps a zero-slot day in availableDays as Full, but never selects it (Tori, 2026-08-18)', async () => {
    let call = 0
    mocks.computeDaySlotsFast.mockImplementation(async () => {
      call += 1
      // First day scanned is fully booked; every day after it has openings.
      if (call === 1) {
        return {
          ok: true,
          dayStartUtc: new Date('2030-01-01T00:00:00.000Z'),
          dayEndExclusiveUtc: new Date('2030-01-02T00:00:00.000Z'),
          slots: [],
        }
      }
      return {
        ok: true,
        dayStartUtc: new Date('2030-01-02T00:00:00.000Z'),
        dayEndExclusiveUtc: new Date('2030-01-03T00:00:00.000Z'),
        slots: ['2030-01-02T09:00:00.000Z', '2030-01-02T10:00:00.000Z'],
      }
    })

    const response = await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.availableDays).toEqual(
      expect.arrayContaining([expect.objectContaining({ slotCount: 0 })]),
    )
    expect(body.availableDays.length).toBeGreaterThan(1)

    // The Full day must never be the one the sheet opens to.
    expect(body.selectedDay).not.toBeNull()
    const fullDay = body.availableDays.find(
      (d: { slotCount: number }) => d.slotCount === 0,
    )
    expect(body.selectedDay.date).not.toBe(fullDay?.date)
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

  it('redacts the street address of a pro who has not published one, but still names the area', async () => {
    // 🔴 This route is UNAUTHENTICATED and a "salon" is frequently a home
    // studio, so `isAddressPublic` is the only thing standing between a pro who
    // never published an address and an anonymous caller reading it. It was not
    // consulted at all before this test existed.
    mocks.professionalLocationFindMany.mockResolvedValue([
      {
        id: 'published',
        type: 'SALON',
        name: 'Downtown Studio',
        city: 'New York',
        state: 'NY',
        formattedAddress: '1 Main St, New York, NY',
        isAddressPublic: true,
        isPrimary: true,
      },
      {
        id: 'home-studio',
        type: 'SUITE',
        name: 'Mara Vance Beauty',
        city: 'Brooklyn',
        state: 'NY',
        formattedAddress: '2 Side St, Brooklyn, NY',
        isAddressPublic: false,
        isPrimary: false,
      },
    ])

    const response = await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
    })
    const body = await response.json()

    expect(body.locationOptions).toEqual([
      expect.objectContaining({
        id: 'published',
        formattedAddress: '1 Main St, New York, NY',
        areaLabel: 'New York, NY',
      }),
      expect.objectContaining({
        id: 'home-studio',
        formattedAddress: null,
        areaLabel: 'Brooklyn, NY',
      }),
    ])

    // The address must be absent from the whole payload, not merely from the
    // field the sheet happens to read.
    expect(JSON.stringify(body)).not.toContain('2 Side St')
  })

  it('carries the pro\'s travel reach in SALON mode too, so the toggle has it in hand', async () => {
    // The client meets this line by flipping to Mobile — at which point
    // availability refuses until they name an address, so there is no fresh
    // payload to read it from.
    mocks.professionalProfileFindUnique.mockResolvedValue({ mobileRadiusMiles: 12 })
    mocks.professionalLocationFindFirst.mockResolvedValue({
      city: 'Brooklyn',
      state: 'NY',
    })

    const response = await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
    })
    const body = await response.json()

    expect(body.serviceArea).toEqual({ radiusMiles: 12, areaLabel: 'Brooklyn, NY' })
  })

  it('omits the service area entirely when the pro has published no reach', async () => {
    // Half a promise ("up to null miles around null") is worse than none: the
    // sheet renders no line at all rather than a sentence with a hole in it.
    mocks.professionalProfileFindUnique.mockResolvedValue({ mobileRadiusMiles: null })
    mocks.professionalLocationFindFirst.mockResolvedValue(null)

    const response = await getBootstrap({
      professionalId: 'pro-1',
      serviceId: 'service-1',
    })
    const body = await response.json()

    expect(body.serviceArea ?? null).toBeNull()
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
