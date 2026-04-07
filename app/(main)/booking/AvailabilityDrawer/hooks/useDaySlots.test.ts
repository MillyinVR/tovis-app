// app/(main)/booking/AvailabilityDrawer/hooks/useDaySlots.test.ts
// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AvailabilityBootstrapResponse,
  AvailabilityDayResponse,
  ServiceLocationType,
} from '../types'

import { useDaySlots } from './useDaySlots'

const mocks = vi.hoisted(() => ({
  safeJson: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('../utils/safeJson', () => ({
  safeJson: mocks.safeJson,
}))

type BootstrapOk = Extract<AvailabilityBootstrapResponse, { ok: true }>
type DayOk = Extract<AvailabilityDayResponse, { ok: true }>

type HookProps = {
  open: boolean
  summary: BootstrapOk | null
  selectedDayYMD: string | null
  activeLocationType: ServiceLocationType
  effectiveServiceId: string | null
  selectedClientAddressId: string | null
  debug: boolean
  holding: boolean
  retryKey: number
  setError: (value: string | null) => void
}

const DAY_1 = '2026-03-11'
const DAY_2 = '2026-03-12'
const SLOT_DAY_1 = '2026-03-11T17:00:00.000Z'
const SLOT_DAY_2_A = '2026-03-12T18:00:00.000Z'
const SLOT_DAY_2_B = '2026-03-12T18:15:00.000Z'

function addOneDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function makeSummary(overrides: Partial<BootstrapOk> = {}): BootstrapOk {
  const request = {
    professionalId: 'pro_1',
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
    windowStartDate: DAY_1,
    windowEndDate: DAY_2,
    nextStartDate: null,
    hasMoreDays: false,
    primaryPro: {
      id: request.professionalId,
      businessName: 'Test Pro',
      avatarUrl: null,
      location: 'Los Angeles',
      offeringId: 'offering_1',
      isCreator: true,
      timeZone: 'America/Los_Angeles',
      locationId: request.locationId,
    },
    availableDays: [
      { date: DAY_1, slotCount: 1 },
      { date: DAY_2, slotCount: 2 },
    ],
    selectedDay: null,
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

function makeHookProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    open: true,
    summary: makeSummary(),
    selectedDayYMD: DAY_2,
    activeLocationType: 'SALON',
    effectiveServiceId: 'service_1',
    selectedClientAddressId: null,
    debug: false,
    holding: false,
    retryKey: 0,
    setError: vi.fn(),
    ...overrides,
  }
}

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeDayResponse(
  slots: string[],
  overrides: Partial<DayOk> = {},
): DayOk {
  const request = {
    professionalId: 'pro_1',
    serviceId: 'service_1',
    offeringId: 'offering_1',
    locationType: 'SALON' as const,
    locationId: 'loc_1',
    clientAddressId: null,
    addOnIds: [],
    durationMinutes: 60,
    date: DAY_2,
    ...(overrides.request ?? {}),
  }

  return {
    ok: true,
    mode: 'DAY',
    availabilityVersion: 'day_v1',
    generatedAt: new Date().toISOString(),
    request,
    professionalId: request.professionalId,
    serviceId: request.serviceId,
    locationType: request.locationType,
    locationId: request.locationId,
    date: request.date,
    durationMinutes: request.durationMinutes,
    timeZone: 'America/Los_Angeles',
    stepMinutes: 15,
    leadTimeMinutes: 0,
    locationBufferMinutes: 15,
    adjacencyBufferMinutes: 15,
    maxDaysAhead: 30,
    dayStartUtc: `${request.date}T00:00:00.000Z`,
    dayEndExclusiveUtc: `${addOneDay(request.date)}T00:00:00.000Z`,
    slots,
    ...overrides,
  }
}

describe('useDaySlots', () => {
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

  it('uses fresh bootstrap selectedDay slots without fetching', async () => {
    const summary = makeSummary({
      availableDays: [{ date: DAY_1, slotCount: 1 }],
      selectedDay: {
        date: DAY_1,
        slots: [SLOT_DAY_1],
      },
      generatedAt: new Date().toISOString(),
    })

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
        summary,
        selectedDayYMD: DAY_1,
      }),
    })

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
      expect(result.current.primarySlots).toEqual([SLOT_DAY_1])
    })

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('fetches day slots when bootstrap selectedDay is stale', async () => {
    mocks.fetch.mockResolvedValueOnce(
      makeResponse(
        makeDayResponse([SLOT_DAY_1], {
          request: {
            professionalId: 'pro_1',
            serviceId: 'service_1',
            offeringId: 'offering_1',
            locationType: 'SALON',
            locationId: 'loc_1',
            clientAddressId: null,
            addOnIds: [],
            durationMinutes: 60,
            date: DAY_1,
          },
        }),
      ),
    )

    const summary = makeSummary({
      availableDays: [{ date: DAY_1, slotCount: 1 }],
      selectedDay: {
        date: DAY_1,
        slots: ['2026-03-11T16:00:00.000Z'],
      },
      generatedAt: '2020-01-01T00:00:00.000Z',
    })

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
        summary,
        selectedDayYMD: DAY_1,
      }),
    })

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
      expect(result.current.primarySlots).toEqual([SLOT_DAY_1])
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not fetch mobile slots until a client address is selected', async () => {
    const summary = makeSummary({
      request: {
        professionalId: 'pro_1',
        serviceId: 'service_1',
        offeringId: 'offering_1',
        locationType: 'MOBILE',
        locationId: 'loc_mobile',
        clientAddressId: null,
        addOnIds: [],
        durationMinutes: 60,
      },
      availableDays: [{ date: DAY_2, slotCount: 2 }],
      selectedDay: null,
    })

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
        summary,
        activeLocationType: 'MOBILE',
        selectedClientAddressId: null,
        selectedDayYMD: DAY_2,
      }),
    })

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
      expect(result.current.primarySlots).toEqual([])
    })

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('forces a refetch when retryKey changes even if bootstrap selectedDay exists', async () => {
    const setError = vi.fn()
    const summary = makeSummary({
      availableDays: [{ date: DAY_2, slotCount: 1 }],
      selectedDay: {
        date: DAY_2,
        slots: [SLOT_DAY_2_A],
      },
      generatedAt: new Date().toISOString(),
    })

    const { result, rerender } = renderHook(
      (props: HookProps) => useDaySlots(props),
      {
        initialProps: makeHookProps({
          summary,
          selectedDayYMD: DAY_2,
          retryKey: 0,
          setError,
        }),
      },
    )

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
      expect(result.current.primarySlots).toEqual([SLOT_DAY_2_A])
    })

    expect(mocks.fetch).not.toHaveBeenCalled()

    mocks.fetch.mockResolvedValueOnce(
      makeResponse(makeDayResponse([SLOT_DAY_2_B])),
    )

    rerender(
      makeHookProps({
        summary,
        selectedDayYMD: DAY_2,
        retryKey: 1,
        setError,
      }),
    )

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
      expect(result.current.primarySlots).toEqual([SLOT_DAY_2_B])
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('surfaces a primary slot error when the day request fails', async () => {
    const setError = vi.fn()

    mocks.fetch.mockResolvedValueOnce(
      makeResponse({ error: 'Could not load day' }, 500),
    )

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
        summary: makeSummary({
          availableDays: [{ date: DAY_2, slotCount: 1 }],
        }),
        selectedDayYMD: DAY_2,
        setError,
      }),
    })

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
    })

    expect(result.current.primarySlots).toEqual([])
    expect(setError).toHaveBeenCalledWith('Could not load day')
  })

  it('does not call setError while holding is in progress', async () => {
    const setError = vi.fn()

    mocks.fetch.mockResolvedValueOnce(
      makeResponse({ error: 'Could not load day' }, 500),
    )

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
        summary: makeSummary({
          availableDays: [{ date: DAY_2, slotCount: 1 }],
        }),
        selectedDayYMD: DAY_2,
        holding: true,
        setError,
      }),
    })

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
    })

    expect(result.current.primarySlots).toEqual([])
    expect(setError).not.toHaveBeenCalled()
  })

  it('clearDaySlots resets the local slot state immediately', async () => {
    const summary = makeSummary({
      availableDays: [{ date: DAY_1, slotCount: 1 }],
      selectedDay: {
        date: DAY_1,
        slots: [SLOT_DAY_1],
      },
      generatedAt: new Date().toISOString(),
    })

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
        summary,
        selectedDayYMD: DAY_1,
      }),
    })

    await waitFor(() => {
      expect(result.current.primarySlots).toEqual([SLOT_DAY_1])
    })

    act(() => {
      result.current.clearDaySlots()
    })

    expect(result.current.loadingPrimarySlots).toBe(false)
    expect(result.current.primarySlots).toEqual([])
  })
})
