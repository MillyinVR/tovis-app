// app/(main)/booking/AvailabilityDrawer/hooks/useDaySlots.test.ts
// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AvailabilitySummaryResponse,
  ServiceLocationType,
} from '../types'

const mocks = vi.hoisted(() => ({
  safeJson: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('../utils/safeJson', () => ({
  safeJson: mocks.safeJson,
}))

type DaySlotsSummary = Extract<
  AvailabilitySummaryResponse,
  { ok: true; mode: 'SUMMARY' }
>

type HookProps = {
  open: boolean
  summary: DaySlotsSummary | null
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
const SLOT_PRIMARY = '2026-03-12T19:00:00.000Z'
const SLOT_OTHER_2 = '2026-03-12T19:15:00.000Z'
const SLOT_OTHER_3 = '2026-03-12T19:30:00.000Z'

function makeSummary(overrides?: Partial<DaySlotsSummary>): DaySlotsSummary {
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
    windowStartDate: DAY_1,
    windowEndDate: DAY_2,
    nextStartDate: null,
    hasMoreDays: false,
    firstDaySlots: [SLOT_DAY_1],
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
      { date: DAY_1, slotCount: 2 },
      { date: DAY_2, slotCount: 2 },
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

function makeHookProps(overrides?: Partial<HookProps>): HookProps {
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

function makeDayResponse(slots: string[]) {
  return {
    ok: true,
    mode: 'DAY',
    slots,
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

  it('uses first-day slots from summary cache without fetching again', async () => {
    const summary = makeSummary({
      availableDays: [{ date: DAY_1, slotCount: 1 }],
      firstDaySlots: [SLOT_DAY_1],
    })

    const { useDaySlots } = await import('./useDaySlots')

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

  it('does not fetch mobile slots until a client address is selected', async () => {
    const { useDaySlots } = await import('./useDaySlots')

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
        activeLocationType: 'MOBILE',
        selectedClientAddressId: null,
        selectedDayYMD: DAY_2,
      }),
    })

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
    })

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(result.current.primarySlots).toEqual([])
  })

  it('bypasses cached primary slots when retryKey changes', async () => {
    mocks.fetch.mockResolvedValueOnce(
      makeResponse(makeDayResponse([SLOT_DAY_2_A])),
    )

    const { useDaySlots } = await import('./useDaySlots')
    const setError = vi.fn()

    const { result, rerender } = renderHook(
      (props: HookProps) => useDaySlots(props),
      {
        initialProps: makeHookProps({
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

    mocks.fetch.mockResolvedValueOnce(
      makeResponse(makeDayResponse([SLOT_DAY_2_B])),
    )

    rerender(
      makeHookProps({
        selectedDayYMD: DAY_2,
        retryKey: 1,
        setError,
      }),
    )

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
      expect(result.current.primarySlots).toEqual([SLOT_DAY_2_B])
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('loadOtherSlots reuses cached other-pro slots and fetches only missing pros', async () => {
    const summary = makeSummary({
      otherPros: [
        {
          id: 'pro_2',
          businessName: 'Nearby Pro 2',
          avatarUrl: null,
          location: 'Los Angeles',
          offeringId: 'offering_1',
          isCreator: false,
          timeZone: 'America/Los_Angeles',
          locationId: 'loc_2',
        },
        {
          id: 'pro_3',
          businessName: 'Nearby Pro 3',
          avatarUrl: null,
          location: 'Los Angeles',
          offeringId: 'offering_1',
          isCreator: false,
          timeZone: 'America/Los_Angeles',
          locationId: 'loc_3',
        },
      ],
    })

    mocks.fetch.mockResolvedValueOnce(
      makeResponse(makeDayResponse([SLOT_PRIMARY])),
    )

    const { useDaySlots } = await import('./useDaySlots')
    const setError = vi.fn()

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
        summary,
        selectedDayYMD: DAY_2,
        setError,
      }),
    })

    await waitFor(() => {
      expect(result.current.loadingPrimarySlots).toBe(false)
      expect(result.current.primarySlots).toEqual([SLOT_PRIMARY])
    })

    mocks.fetch.mockResolvedValueOnce(
      makeResponse(makeDayResponse([SLOT_OTHER_2])),
    )

    await act(async () => {
    const slots = await result.current.fetchDaySlots({
        proId: 'pro_2',
        ymd: DAY_2,
        locationType: 'SALON',
        locationId: 'loc_2',
        })
      expect(slots).toEqual([SLOT_OTHER_2])
    })

    mocks.fetch.mockResolvedValueOnce(
      makeResponse(makeDayResponse([SLOT_OTHER_3])),
    )

    await act(async () => {
      await result.current.loadOtherSlots()
    })

    await waitFor(() => {
      expect(result.current.loadingOtherSlots).toBe(false)
      expect(result.current.otherSlots).toEqual({
        pro_2: [SLOT_OTHER_2],
        pro_3: [SLOT_OTHER_3],
      })
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(3)
  })

  it('surfaces a primary slot error when the day request fails', async () => {
    const setError = vi.fn()

    mocks.fetch.mockResolvedValueOnce(
      makeResponse({ error: 'Could not load day' }, 500),
    )

    const { useDaySlots } = await import('./useDaySlots')

    const { result } = renderHook((props: HookProps) => useDaySlots(props), {
      initialProps: makeHookProps({
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
})