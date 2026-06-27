// app/(main)/booking/AvailabilityDrawer/hooks/useAvailabilityAlternates.test.ts
// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AvailabilityAlternatesResponse,
  AvailabilityBootstrapResponse,
  DrawerContext,
  ServiceLocationType,
} from '../types'

import { useAvailabilityAlternates } from './useAvailabilityAlternates'

const mocks = vi.hoisted(() => ({
  safeJson: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('../utils/safeJson', () => ({
  safeJson: mocks.safeJson,
}))

type BootstrapOk = Extract<AvailabilityBootstrapResponse, { ok: true }>
type AlternatesOk = Extract<AvailabilityAlternatesResponse, { ok: true }>

type HookProps = {
  open: boolean
  requested: boolean
  summary: BootstrapOk | null
  context: DrawerContext
  selectedDayYMD: string | null
  activeLocationType: ServiceLocationType
  selectedClientAddressId: string | null
  debug: boolean
  retryKey: number
}

const DAY = '2026-05-22'
const SLOT_A = '2026-05-22T16:00:00.000Z'
const SLOT_B = '2026-05-22T17:00:00.000Z'

const context: DrawerContext = {
  professionalId: 'pro_primary',
  serviceId: 'service_1',
  offeringId: 'offering_1',
  source: 'REQUESTED',
  viewerLat: 34.0522,
  viewerLng: -118.2437,
  viewerRadiusMiles: 15,
  viewerPlaceId: 'place_la',
}

function makeSummary(overrides: Partial<BootstrapOk> = {}): BootstrapOk {
  const request = {
    professionalId: 'pro_primary',
    serviceId: 'service_1',
    offeringId: 'offering_1',
    locationType: 'SALON' as const,
    locationId: 'loc_1',
    clientAddressId: null,
    addOnIds: [],
    durationMinutes: 60,
    ...(overrides.request ?? {}),
  }

  const summary: BootstrapOk = {
    ok: true,
    mode: 'BOOTSTRAP',
    availabilityVersion: 'bootstrap_v1',
    generatedAt: new Date().toISOString(),
    request,
    mediaId: null,
    serviceName: 'Haircut',
    serviceCategoryName: 'Hair',
    professionalId: request.professionalId,
    serviceId: request.serviceId,
    locationType: request.locationType,
    locationId: request.locationId,
    durationMinutes: request.durationMinutes,
    timeZone: 'America/Los_Angeles',
    stepMinutes: 15,
    leadTimeMinutes: 0,
    locationBufferMinutes: 15,
    adjacencyBufferMinutes: 15,
    maxDaysAhead: 30,
    windowStartDate: DAY,
    windowEndDate: DAY,
    nextStartDate: null,
    hasMoreDays: false,
    primaryPro: {
      id: request.professionalId,
      businessName: 'Primary Pro',
      avatarUrl: null,
      location: 'Los Angeles',
      offeringId: request.offeringId ?? 'offering_1',
      isCreator: true,
      timeZone: 'America/Los_Angeles',
      locationId: request.locationId,
    },
    availableDays: [{ date: DAY, slotCount: 1 }],
    selectedDay: null,
    otherPros: [],
    locationOptions: [],
    waitlistSupported: true,
    offering: {
      id: 'offering_1',
      offersInSalon: true,
      offersMobile: true,
      salonDurationMinutes: 60,
      mobileDurationMinutes: 75,
      salonPriceStartingAt: '100.00',
      mobilePriceStartingAt: '120.00',
    },
  }

  return {
    ...summary,
    ...overrides,
    request,
    professionalId: request.professionalId,
    serviceId: request.serviceId,
    locationType: request.locationType,
    locationId: request.locationId,
    durationMinutes: request.durationMinutes,
    primaryPro: {
      ...summary.primaryPro,
      locationId: request.locationId,
      ...(overrides.primaryPro ?? {}),
    },
  }
}

function makeAlternatesResponse(
  overrides: Partial<AlternatesOk> = {},
): AlternatesOk {
  const request: AlternatesOk['request'] = {
    serviceId: 'service_1',
    offeringId: 'offering_1',
    locationType: 'SALON',
    locationId: 'loc_1',
    clientAddressId: null,
    addOnIds: [],
    durationMinutes: 60,
    date: DAY,
    ...(overrides.request ?? {}),
  }

  return {
    ok: true,
    mode: 'ALTERNATES',
    availabilityVersion: 'alternates_v1',
    generatedAt: new Date().toISOString(),
    request,
    selectedDay: DAY,
    alternates: [
      {
        pro: {
          id: 'pro_alt_1',
          businessName: 'Alternate Pro',
          avatarUrl: null,
          location: 'Santa Monica',
          distanceMiles: 2.4,
          offeringId: 'offering_alt_1',
          isCreator: false,
          timeZone: 'America/Los_Angeles',
          locationId: 'loc_alt_1',
        },
        slots: [SLOT_A, SLOT_B],
      },
    ],
    ...overrides,
  }
}

function makeHookProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    open: true,
    requested: true,
    summary: makeSummary(),
    context,
    selectedDayYMD: DAY,
    activeLocationType: 'SALON',
    selectedClientAddressId: null,
    debug: false,
    retryKey: 0,
    ...overrides,
  }
}

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getFetchUrl(): URL {
  const firstArg = mocks.fetch.mock.calls[0]?.[0]

  if (typeof firstArg !== 'string') {
    throw new Error('Expected fetch URL to be a string.')
  }

  return new URL(firstArg, 'http://localhost')
}

describe('useAvailabilityAlternates', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.safeJson.mockImplementation(async (response: Response) =>
      response.json(),
    )

    mocks.fetch.mockReset()
    vi.stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not fetch until alternates are requested', async () => {
    const { result } = renderHook(
      (props: HookProps) => useAvailabilityAlternates(props),
      {
        initialProps: makeHookProps({
          requested: false,
        }),
      },
    )

    expect(result.current.data).toBeNull()
    expect(result.current.otherSlots).toEqual({})
    expect(result.current.loadingAlternates).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('fetches alternates and maps slots by pro id', async () => {
    mocks.fetch.mockResolvedValueOnce(
      makeResponse(makeAlternatesResponse()),
    )

    const { result } = renderHook(
      (props: HookProps) => useAvailabilityAlternates(props),
      {
        initialProps: makeHookProps(),
      },
    )

    await waitFor(() => {
      expect(result.current.loadingAlternates).toBe(false)
      expect(result.current.data?.mode).toBe('ALTERNATES')
      expect(result.current.otherSlots).toEqual({
        pro_alt_1: [SLOT_A, SLOT_B],
      })
    })

    const url = getFetchUrl()

    expect(url.pathname).toBe('/api/v1/availability/alternates')
    expect(url.searchParams.get('professionalId')).toBe('pro_primary')
    expect(url.searchParams.get('serviceId')).toBe('service_1')
    expect(url.searchParams.get('offeringId')).toBe('offering_1')
    expect(url.searchParams.get('date')).toBe(DAY)
    expect(url.searchParams.get('locationType')).toBe('SALON')
    expect(url.searchParams.get('locationId')).toBe('loc_1')
    expect(url.searchParams.get('viewerLat')).toBe('34.0522')
    expect(url.searchParams.get('viewerLng')).toBe('-118.2437')
    expect(url.searchParams.get('radiusMiles')).toBe('15')
    expect(url.searchParams.get('viewerPlaceId')).toBe('place_la')
  })

  it('does not fetch mobile alternates until a client address is selected', async () => {
    const summary = makeSummary({
      request: {
        professionalId: 'pro_primary',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        locationType: 'MOBILE',
        locationId: 'loc_mobile',
        clientAddressId: null,
        addOnIds: [],
        durationMinutes: 75,
      },
    })

    const { result } = renderHook(
      (props: HookProps) => useAvailabilityAlternates(props),
      {
        initialProps: makeHookProps({
          summary,
          activeLocationType: 'MOBILE',
          selectedClientAddressId: null,
        }),
      },
    )

    await waitFor(() => {
      expect(result.current.loadingAlternates).toBe(false)
      expect(result.current.data).toBeNull()
      expect(result.current.otherSlots).toEqual({})
    })

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

    it('includes clientAddressId for mobile alternates when selected', async () => {
    const summary = makeSummary({
        request: {
        professionalId: 'pro_primary',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        locationType: 'MOBILE',
        locationId: 'loc_mobile',
        clientAddressId: 'addr_1',
        addOnIds: [],
        durationMinutes: 75,
        },
    })

    const mobileAlternates = makeAlternatesResponse({
        request: {
        ...makeAlternatesResponse().request,
        locationType: 'MOBILE',
        locationId: 'loc_mobile',
        clientAddressId: 'addr_1',
        durationMinutes: 75,
        },
    })

    mocks.fetch.mockResolvedValueOnce(makeResponse(mobileAlternates))

    renderHook((props: HookProps) => useAvailabilityAlternates(props), {
        initialProps: makeHookProps({
        summary,
        activeLocationType: 'MOBILE',
        selectedClientAddressId: 'addr_1',
        }),
    })

    await waitFor(() => {
        expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    const url = getFetchUrl()

    expect(url.searchParams.get('locationType')).toBe('MOBILE')
    expect(url.searchParams.get('locationId')).toBe('loc_mobile')
    expect(url.searchParams.get('clientAddressId')).toBe('addr_1')
    })

  it('surfaces API errors and clears stale alternate slots', async () => {
    mocks.fetch.mockResolvedValueOnce(
      makeResponse({ error: 'Could not load alternates' }, 500),
    )

    const { result } = renderHook(
      (props: HookProps) => useAvailabilityAlternates(props),
      {
        initialProps: makeHookProps(),
      },
    )

    await waitFor(() => {
      expect(result.current.loadingAlternates).toBe(false)
      expect(result.current.alternatesError).toBe('Could not load alternates')
    })

    expect(result.current.data).toBeNull()
    expect(result.current.otherSlots).toEqual({})
  })

  it('sets a specific auth error on 401 responses', async () => {
    mocks.fetch.mockResolvedValueOnce(
      makeResponse({ ok: false, error: 'Unauthorized' }, 401),
    )

    const { result } = renderHook(
      (props: HookProps) => useAvailabilityAlternates(props),
      {
        initialProps: makeHookProps(),
      },
    )

    await waitFor(() => {
      expect(result.current.loadingAlternates).toBe(false)
      expect(result.current.alternatesError).toBe('Unauthorized.')
    })

    expect(result.current.data).toBeNull()
    expect(result.current.otherSlots).toEqual({})
  })

  it('rejects unexpected successful payloads', async () => {
    mocks.fetch.mockResolvedValueOnce(
      makeResponse({
        ok: true,
        mode: 'BOOTSTRAP',
      }),
    )

    const { result } = renderHook(
      (props: HookProps) => useAvailabilityAlternates(props),
      {
        initialProps: makeHookProps(),
      },
    )

    await waitFor(() => {
      expect(result.current.loadingAlternates).toBe(false)
      expect(result.current.alternatesError).toBe(
        'Alternates endpoint returned unexpected response.',
      )
    })

    expect(result.current.data).toBeNull()
    expect(result.current.otherSlots).toEqual({})
  })

  it('refreshAlternates forces a new request with cache-busting timestamp', async () => {
    mocks.fetch
      .mockResolvedValueOnce(makeResponse(makeAlternatesResponse()))
      .mockResolvedValueOnce(makeResponse(makeAlternatesResponse()))

    const { result } = renderHook(
      (props: HookProps) => useAvailabilityAlternates(props),
      {
        initialProps: makeHookProps(),
      },
    )

    await waitFor(() => {
      expect(result.current.loadingAlternates).toBe(false)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.refreshAlternates()
    })

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
    })

    const secondUrlArg = mocks.fetch.mock.calls[1]?.[0]

    if (typeof secondUrlArg !== 'string') {
      throw new Error('Expected second fetch URL to be a string.')
    }

    const secondUrl = new URL(secondUrlArg, 'http://localhost')

    expect(secondUrl.searchParams.get('_ts')).toEqual(expect.any(String))
  })

  it('clearAlternates aborts active work and resets local state', async () => {
    let resolveFetch: (value: Response) => void = () => {
    throw new Error('resolveFetch was called before fetch was initialized.')
    }

    mocks.fetch.mockImplementationOnce(
    () =>
        new Promise<Response>((resolve) => {
        resolveFetch = resolve
        }),
    )

    const { result } = renderHook(
      (props: HookProps) => useAvailabilityAlternates(props),
      {
        initialProps: makeHookProps(),
      },
    )

    await waitFor(() => {
      expect(result.current.loadingAlternates).toBe(true)
    })

    act(() => {
      result.current.clearAlternates()
    })

    expect(result.current.data).toBeNull()
    expect(result.current.otherSlots).toEqual({})
    expect(result.current.loadingAlternates).toBe(false)
    expect(result.current.alternatesError).toBeNull()

    resolveFetch(makeResponse(makeAlternatesResponse()))

    await Promise.resolve()

    expect(result.current.data).toBeNull()
    expect(result.current.otherSlots).toEqual({})
  })
})