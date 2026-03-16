// app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.test.ts
// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DrawerContext, ServiceLocationType } from '../types'

const mocks = vi.hoisted(() => ({
  useRouter: vi.fn(),
  redirectToLogin: vi.fn(),
  safeJson: vi.fn(),
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

vi.mock('../contract', () => ({
  parseAvailabilitySummaryResponse: mocks.parseAvailabilitySummaryResponse,
}))

type HookProps = {
  open: boolean
  context: DrawerContext
  locationType: ServiceLocationType | null
  clientAddressId: string | null
}

function makeSummary(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    mode: 'SUMMARY',
    mediaId: null,
    serviceId: 'service_1',
    professionalId: 'pro_1',
    serviceName: 'Haircut',
    serviceCategoryName: 'Hair',
    locationType: 'SALON',
    locationId: 'loc_1',
    timeZone: 'America/Los_Angeles',
    stepMinutes: 15,
    leadTimeMinutes: 0,
    locationBufferMinutes: 15,
    adjacencyBufferMinutes: 15,
    maxDaysAhead: 30,
    durationMinutes: 60,
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
    vi.resetModules()
    vi.clearAllMocks()

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

    mocks.parseAvailabilitySummaryResponse.mockImplementation(
      (raw: unknown) => raw,
    )

    mocks.fetch.mockReset()
    vi.stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads availability on first uncached fetch', async () => {
    const summary = makeSummary()
    const fetchGate = deferred<Response>()

    mocks.fetch.mockReturnValueOnce(fetchGate.promise)

    const { useAvailability } = await import('./useAvailability')

    const { result } = renderHook(() =>
      useAvailability(true, makeContext(), 'SALON', null),
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

  it('returns cached data immediately within TTL without refetching', async () => {
    const summary = makeSummary()

    mocks.fetch.mockResolvedValueOnce(makeResponse(summary))

    const { useAvailability } = await import('./useAvailability')

    const first = renderHook(() =>
      useAvailability(true, makeContext(), 'SALON', null),
    )

    await waitFor(() => {
      expect(first.result.current.loading).toBe(false)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(first.result.current.data).toEqual(summary)

    first.unmount()

    const second = renderHook(() =>
      useAvailability(true, makeContext(), 'SALON', null),
    )

    await waitFor(() => {
      expect(second.result.current.loading).toBe(false)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(second.result.current.refreshing).toBe(false)
    expect(second.result.current.data).toEqual(summary)
  })

  it('returns stale cached data and refreshes in the background after TTL', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let nowMs = new Date('2026-03-10T12:00:00.000Z').getTime()
    nowSpy.mockImplementation(() => nowMs)

    const staleSummary = makeSummary({
      serviceName: 'Haircut v1',
    })

    const freshSummary = makeSummary({
      serviceName: 'Haircut v2',
    })

    mocks.fetch.mockResolvedValueOnce(makeResponse(staleSummary))

    const { useAvailability } = await import('./useAvailability')

    const first = renderHook(() =>
      useAvailability(true, makeContext(), 'SALON', null),
    )

    await waitFor(() => {
      expect(first.result.current.loading).toBe(false)
    })

    expect(first.result.current.refreshing).toBe(false)
    expect(first.result.current.data).toEqual(staleSummary)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    first.unmount()

    nowMs += 45_001

    const refreshGate = deferred<Response>()
    mocks.fetch.mockReturnValueOnce(refreshGate.promise)

    const second = renderHook(() =>
      useAvailability(true, makeContext(), 'SALON', null),
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

  it('dedupes concurrent in-flight requests for the same key', async () => {
    const summary = makeSummary()
    const fetchGate = deferred<Response>()

    mocks.fetch.mockReturnValueOnce(fetchGate.promise)

    const { useAvailability } = await import('./useAvailability')

    const first = renderHook(() =>
      useAvailability(true, makeContext(), 'SALON', null),
    )

    const second = renderHook(() =>
      useAvailability(true, makeContext(), 'SALON', null),
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
        ),
      {
        initialProps: makeHookProps({
          open: true,
          context: makeContext(),
          locationType: 'MOBILE',
          clientAddressId: null,
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
    })

    mocks.fetch.mockResolvedValueOnce(makeResponse(summary))

    rerender(
      makeHookProps({
        open: true,
        context: makeContext(),
        locationType: 'MOBILE',
        clientAddressId: 'addr_1',
      }),
    )

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(summary)
  })

  it('redirects on 401 and surfaces the login message', async () => {
  mocks.fetch.mockResolvedValueOnce(
    makeResponse({ error: 'Unauthorized' }, 401),
  )

  mocks.safeJson.mockResolvedValueOnce({
    error: 'Please log in to view availability.',
  })

  const { useAvailability } = await import('./useAvailability')

  const { result } = renderHook(() =>
    useAvailability(true, makeContext(), 'SALON', null),
  )

  await waitFor(() => {
    expect(result.current.loading).toBe(false)
  })

  expect(mocks.redirectToLogin).toHaveBeenCalledTimes(1)
  expect(mocks.redirectToLogin).toHaveBeenCalledWith(
    expect.anything(),
    'availability',
  )
  expect(result.current.error).toBe('Please log in to view availability.')
  expect(result.current.data).toBeNull()
})
})