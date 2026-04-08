// app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.test.ts
// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DrawerContext, ServiceLocationType } from '../types'
import { clearAvailabilitySummaryPrefetchCache } from '../utils/availabilityPrefetch'

const mocks = vi.hoisted(() => ({
  useRouter: vi.fn(),
  redirectToLogin: vi.fn(),
  safeJson: vi.fn(),
  parseAvailabilityBootstrapResponse: vi.fn(),
  parseAvailabilitySummaryResponse: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: mocks.useRouter,
}))

vi.mock('../utils/authRedirect', () => ({
  redirectToLogin: mocks.redirectToLogin,
}))

vi.mock('../utils/safeJson', () => ({
  safeJson: mocks.safeJson,
}))

vi.mock('../contract', async () => {
  const actual =
    await vi.importActual<typeof import('../contract')>('../contract')

  return {
    ...actual,
    parseAvailabilityBootstrapResponse:
      mocks.parseAvailabilityBootstrapResponse,
    parseAvailabilitySummaryResponse:
      mocks.parseAvailabilitySummaryResponse,
  }
})

type HookProps = {
  open: boolean
  context: DrawerContext
  locationType: ServiceLocationType | null
  clientAddressId: string | null
  includeOtherPros: boolean
}

function makeSummary(
  overrides?: Partial<Record<string, unknown>> & {
    request?: Partial<{
      professionalId: string
      serviceId: string
      offeringId: string | null
      locationType: ServiceLocationType
      locationId: string
      clientAddressId: string | null
      addOnIds: string[]
      durationMinutes: number
    }>
  },
) {
  const request = {
    professionalId: 'pro_1',
    serviceId: 'service_1',
    offeringId: null,
    locationType: 'SALON' as ServiceLocationType,
    locationId: 'loc_1',
    clientAddressId: null,
    addOnIds: [],
    durationMinutes: 60,
    ...(overrides?.request ?? {}),
  }

  return {
  ok: true,
  mode: 'BOOTSTRAP',
  availabilityVersion: 'av_v1',
  generatedAt: '2026-03-10T12:00:00.000Z',
  mediaId: null,
  serviceId: request.serviceId,
  professionalId: request.professionalId,
  serviceName: 'Haircut',
  serviceCategoryName: 'Hair',
  locationType: request.locationType,
  locationId: request.locationId,
  timeZone: 'America/Los_Angeles',
  stepMinutes: 15,
  leadTimeMinutes: 0,
  locationBufferMinutes: 15,
  adjacencyBufferMinutes: 15,
  maxDaysAhead: 30,
  durationMinutes: request.durationMinutes,
  windowStartDate: '2026-03-11',
  windowEndDate: '2026-03-12',
  nextStartDate: null,
  hasMoreDays: false,
  selectedDay: {
    date: '2026-03-11',
    slots: ['2026-03-11T17:00:00.000Z'],
  },
  primaryPro: {
    id: 'pro_1',
    businessName: 'Test Pro',
    avatarUrl: null,
    location: 'Los Angeles',
    offeringId: 'offering_1',
    isCreator: true,
    timeZone: 'America/Los_Angeles',
    locationId: 'loc_1',
  },
  availableDays: [
    { date: '2026-03-11', slotCount: 4 },
    { date: '2026-03-12', slotCount: 2 },
  ],
  otherPros: [],
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
  ...overrides,
  request,
}
}

function makeContext(overrides?: Partial<DrawerContext>): DrawerContext {
  return {
    professionalId: 'pro_1',
    serviceId: 'service_1',
    mediaId: null,
    source: undefined,
    offeringId: null,
    viewerLat: null,
    viewerLng: null,
    viewerRadiusMiles: null,
    viewerPlaceId: null,
    ...overrides,
  }
}

function makeHookProps(overrides?: Partial<HookProps>): HookProps {
  return {
    open: true,
    context: makeContext(),
    locationType: 'SALON',
    clientAddressId: null,
    includeOtherPros: false,
    ...overrides,
  }
}

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

describe('useAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    clearAvailabilitySummaryPrefetchCache()

    mocks.useRouter.mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    })

    mocks.safeJson.mockImplementation(async (response: Response) =>
      response.json(),
    )

    mocks.parseAvailabilityBootstrapResponse.mockImplementation(
      (raw: unknown) => raw,
    )

    mocks.parseAvailabilitySummaryResponse.mockImplementation(
      (raw: unknown) => raw,
    )

    mocks.fetch.mockReset()
    vi.stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => {
    clearAvailabilitySummaryPrefetchCache()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads primary availability on first uncached fetch', async () => {
    const summary = makeSummary()
    const fetchGate = deferred<Response>()

    mocks.fetch.mockReturnValueOnce(fetchGate.promise)

    const { useAvailability } = await import('./useAvailability')

    const { result } = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    expect(result.current.loading).toBe(true)
    expect(result.current.refreshing).toBe(false)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()

    await act(async () => {
      fetchGate.resolve(makeResponse(summary))
      await flushMicrotasks(5)
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(result.current.refreshing).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.data).toEqual(summary)
  })

  it('returns cached primary data immediately within TTL without refetching', async () => {
    const summary = makeSummary()

    mocks.fetch.mockResolvedValueOnce(makeResponse(summary))

    const { useAvailability } = await import('./useAvailability')

    const first = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    await waitFor(() => {
      expect(first.result.current.loading).toBe(false)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(first.result.current.data).toEqual(summary)

    first.unmount()

    const second = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    await waitFor(() => {
      expect(second.result.current.loading).toBe(false)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(second.result.current.refreshing).toBe(false)
    expect(second.result.current.data).toEqual(summary)
  })

  it('returns stale cached data and refreshes in the background after TTL without blanking', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let nowMs = new Date('2026-03-10T12:00:00.000Z').getTime()
    nowSpy.mockImplementation(() => nowMs)

    const staleSummary = makeSummary({
      availabilityVersion: 'av_v1',
      serviceName: 'Haircut v1',
    })

    const freshSummary = makeSummary({
      availabilityVersion: 'av_v2',
      generatedAt: '2026-03-10T12:03:01.000Z',
      serviceName: 'Haircut v2',
    })

    mocks.fetch.mockResolvedValueOnce(makeResponse(staleSummary))

    const { useAvailability } = await import('./useAvailability')

    const first = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    await waitFor(() => {
      expect(first.result.current.loading).toBe(false)
    })

    expect(first.result.current.refreshing).toBe(false)
    expect(first.result.current.data).toEqual(staleSummary)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    first.unmount()

    nowMs += 180_001

    const refreshGate = deferred<Response>()
    mocks.fetch.mockReturnValueOnce(refreshGate.promise)

    const second = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    await waitFor(() => {
      expect(second.result.current.data).toEqual(staleSummary)
      expect(second.result.current.loading).toBe(false)
      expect(second.result.current.refreshing).toBe(true)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(2)

    await act(async () => {
      refreshGate.resolve(makeResponse(freshSummary))
      await flushMicrotasks(5)
    })

    await waitFor(() => {
      expect(second.result.current.refreshing).toBe(false)
    })

    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.data).toEqual(freshSummary)
  })

  it('renders cached primary data first and loads other pros in the background', async () => {
    const primaryOnlySummary = makeSummary({
      otherPros: [],
    })

    const fullSummary = makeSummary({
      availabilityVersion: 'av_v2',
      generatedAt: '2026-03-10T12:01:00.000Z',
      otherPros: [
        {
          id: 'pro_2',
          businessName: 'Nearby Pro',
          avatarUrl: null,
          location: 'Los Angeles',
          offeringId: 'offering_1',
          isCreator: false,
          timeZone: 'America/Los_Angeles',
          locationId: 'loc_2',
          distanceMiles: 1.2,
        },
      ],
    })

    mocks.fetch.mockResolvedValueOnce(makeResponse(primaryOnlySummary))

    const { useAvailability } = await import('./useAvailability')

    const seed = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    await waitFor(() => {
      expect(seed.result.current.loading).toBe(false)
    })

    expect(seed.result.current.data).toEqual(primaryOnlySummary)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    seed.unmount()

    const fullFetchGate = deferred<Response>()
    mocks.fetch.mockReturnValueOnce(fullFetchGate.promise)

    const second = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: true,
        }),
      },
    )

    await waitFor(() => {
      expect(second.result.current.data).toEqual(primaryOnlySummary)
      expect(second.result.current.loading).toBe(false)
      expect(second.result.current.refreshing).toBe(true)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(2)

    await act(async () => {
      fullFetchGate.resolve(makeResponse(fullSummary))
      await flushMicrotasks(5)
    })

    await waitFor(() => {
      expect(second.result.current.refreshing).toBe(false)
    })

    expect(second.result.current.data).toEqual(fullSummary)
  })

  it('dedupes concurrent in-flight primary requests for the same key', async () => {
    const summary = makeSummary()
    const fetchGate = deferred<Response>()

    mocks.fetch.mockReturnValueOnce(fetchGate.promise)

    const { useAvailability } = await import('./useAvailability')

    const first = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    const second = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      fetchGate.resolve(makeResponse(summary))
      await flushMicrotasks(5)
    })

    await waitFor(() => {
      expect(first.result.current.loading).toBe(false)
      expect(second.result.current.loading).toBe(false)
    })

    expect(first.result.current.data).toEqual(summary)
    expect(second.result.current.data).toEqual(summary)
  })

  it('does not fetch mobile availability until a client address is selected', async () => {
    const { useAvailability } = await import('./useAvailability')

    const { result, rerender } = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          open: true,
          context: makeContext(),
          locationType: 'MOBILE',
          clientAddressId: null,
          includeOtherPros: false,
        }),
      },
    )

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.refreshing).toBe(false)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()

    const summary = makeSummary({
      locationType: 'MOBILE',
      request: {
        locationType: 'MOBILE',
        clientAddressId: 'addr_1',
      },
    })

    mocks.fetch.mockResolvedValueOnce(makeResponse(summary))

    rerender(
      makeHookProps({
        open: true,
        context: makeContext(),
        locationType: 'MOBILE',
        clientAddressId: 'addr_1',
        includeOtherPros: false,
      }),
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(summary)
  })

  it('redirects on 401 and surfaces the login message', async () => {
    mocks.fetch.mockResolvedValue(makeResponse({ error: 'Unauthorized.' }, 401))
    mocks.safeJson.mockResolvedValue({
      error: 'Unauthorized.',
    })

    const { useAvailability } = await import('./useAvailability')

    const { result } = renderHook(
      (props: HookProps) =>
        useAvailability(
          props.open,
          props.context,
          props.locationType,
          props.clientAddressId,
          props.includeOtherPros,
        ),
      {
        initialProps: makeHookProps({
          includeOtherPros: false,
        }),
      },
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await waitFor(() => {
      expect(mocks.redirectToLogin).toHaveBeenCalled()
    })

    expect(mocks.redirectToLogin).toHaveBeenCalledWith(
      expect.anything(),
      'availability',
    )
    expect(result.current.error).toBe('Please log in to view availability.')
    expect(result.current.data).toBeNull()
  })
})