// app/pro/calendar/_hooks/useCalendarFetch.scope.test.ts
// @vitest-environment jsdom
//
// K3 — how the calendar ASKS for its events, and what it does with the answer.
//
// The two failure modes pinned here are the ones that quietly undo the
// all-locations view: asking for one location by default (the pre-K3 feed,
// which hides occupancy the DB's professional-wide overlap constraint
// enforces), and adopting the location the response echoes back — which would
// turn every ALL request into a LOCATION one on its own reply
// ([[two-states-owning-one-selection]]).
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProLocation } from '../_utils/parsers'

import { useCalendarFetch } from './useCalendarFetch'

const SALON: ProLocation = {
  id: 'loc_salon',
  type: 'SALON',
  name: 'Studio',
  formattedAddress: null,
  isPrimary: true,
  isBookable: true,
  timeZone: 'America/Los_Angeles',
  workingHours: null,
  stepMinutes: 30,
}

function calendarPayload(overrides: Record<string, unknown> = {}) {
  return {
    professionalId: 'pro_1',
    scope: 'ALL',
    location: {
      id: SALON.id,
      type: 'SALON',
      timeZone: 'America/Los_Angeles',
      timeZoneValid: true,
    },
    range: {
      from: '2026-07-01T07:00:00.000Z',
      requestedTo: '2026-08-12T07:00:00.000Z',
      effectiveTo: '2026-08-12T07:00:00.000Z',
      clamped: false,
      maxDays: 42,
    },
    timeZone: 'America/Los_Angeles',
    viewportTimeZone: 'America/Los_Angeles',
    needsTimeZoneSetup: false,
    events: [],
    canSalon: true,
    canMobile: true,
    stats: { todaysBookings: 0, availableHours: null, pendingRequests: 0, blockedHours: 0 },
    blockedMinutesToday: 0,
    autoAcceptBookings: false,
    management: {
      todaysBookings: [],
      pendingRequests: [],
      waitlistToday: [],
      blockedToday: [],
    },
    ...overrides,
  }
}

describe('useCalendarFetch — calendar scope', () => {
  const fetchMock = vi.fn()
  const setActiveLocationId = vi.fn()

  // Stable identities across renders, like the real callers': the hook rebuilds
  // its loader whenever these change, so fresh lambdas per render would refetch
  // forever and prove nothing about scope.
  const CURRENT_DATE = new Date('2026-07-15T12:00:00.000Z')
  const setCanSalon = vi.fn()
  const setCanMobile = vi.fn()
  const resolveActiveCalendarTimeZone = () => 'America/Los_Angeles'

  function renderFetch(activeLocationId: string | null) {
    return renderHook(() =>
      useCalendarFetch({
        view: 'week',
        currentDate: CURRENT_DATE,
        activeLocationId,
        setActiveLocationId,
        locationsLoaded: true,
        activeLocation: SALON,
        activeLocationType: 'SALON',
        setCanSalon,
        setCanMobile,
        resolveActiveCalendarTimeZone,
      }),
    )
  }

  function calendarRequestUrls(): URL[] {
    return fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.startsWith('/api/v1/pro/calendar?'))
      .map((url) => new URL(url, 'https://tovis.test'))
  }

  beforeEach(() => {
    vi.clearAllMocks()

    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)

      // Working hours are fetched in the background after the grid renders.
      if (url.startsWith('/api/v1/pro/working-hours')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ workingHours: null }),
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => calendarPayload(),
      }
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  it('asks for every location when nothing is filtered', async () => {
    renderFetch(null)

    await waitFor(() => expect(calendarRequestUrls().length).toBeGreaterThan(0))

    const url = calendarRequestUrls()[0]

    expect(url?.searchParams.get('scope')).toBe('ALL')
    // No stray location term: a server reading `locationId` first must not be
    // handed one when the pro asked for everything.
    expect(url?.searchParams.get('locationId')).toBeNull()
  })

  it('asks for one location when the pro filters to it', async () => {
    renderFetch(SALON.id)

    await waitFor(() => expect(calendarRequestUrls().length).toBeGreaterThan(0))

    const url = calendarRequestUrls()[0]

    expect(url?.searchParams.get('scope')).toBe(SALON.id)
    // Sent as well, purely so a server that predates `scope` still honours the
    // pro's choice rather than answering for its primary location.
    expect(url?.searchParams.get('locationId')).toBe(SALON.id)
  })

  it('does not adopt the echoed location while showing every location', async () => {
    renderFetch(null)

    await waitFor(() => expect(calendarRequestUrls().length).toBeGreaterThan(0))

    // The ALL response still carries a `location` — the viewport anchor whose
    // zone the grid is drawn in. Adopting it would filter the calendar to that
    // location on the first load, undoing the request that was just made.
    expect(setActiveLocationId).not.toHaveBeenCalled()
  })

  it('adopts the echoed location when the server says it filtered', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)

      if (url.startsWith('/api/v1/pro/working-hours')) {
        return { ok: true, status: 200, json: async () => ({ workingHours: null }) }
      }

      // What a server that predates `scope` answers: no scope field, and a
      // feed filtered to one location. Believing that was "all locations" is
      // the lie this step removes, so the client falls back to the filter.
      return {
        ok: true,
        status: 200,
        json: async () => {
          const payload = calendarPayload()
          delete (payload as Record<string, unknown>).scope
          return payload
        },
      }
    })

    renderFetch(null)

    await waitFor(() => expect(setActiveLocationId).toHaveBeenCalledWith(SALON.id))
  })
})
