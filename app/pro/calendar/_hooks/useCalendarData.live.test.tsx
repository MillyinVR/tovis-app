// app/pro/calendar/_hooks/useCalendarData.live.test.tsx
//
// Tori, live testing: "when a client approves a consultation the pro has to
// refresh the page to see the approval."
//
// The pro shell has mounted a Realtime subscriber since #416, but it only ever
// called `router.refresh()` — which re-runs SERVER components. The calendar
// holds its events, stats and management lists in THIS hook's state, fetched
// from /api/v1/pro/calendar, so the ping reached the page and changed nothing
// the pro could see. Pinned here: a live ping re-runs the calendar's own fetch.
import { render, renderHook, waitFor } from '@testing-library/react'
import { act, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  onChanged: { current: null as null | (() => void) },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('@/app/_components/live/useLiveChannels', () => ({
  useLiveChannels: (_channels: string[], onChanged: () => void) => {
    mocks.onChanged.current = onChanged
  },
}))

import { LiveRefresh } from '@/app/_components/live/LiveRefresh'

import { useCalendarData } from './useCalendarData'

const LOCATION = {
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

function calendarPayload() {
  return {
    professionalId: 'pro_1',
    scope: 'ALL',
    location: {
      id: LOCATION.id,
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
    canMobile: false,
    stats: {
      todaysBookings: 0,
      availableHours: null,
      pendingRequests: 0,
      blockedHours: 0,
    },
    blockedMinutesToday: 0,
    autoAcceptBookings: false,
    management: {
      todaysBookings: [],
      pendingRequests: [],
      waitlistToday: [],
      blockedToday: [],
    },
  }
}

const CURRENT_DATE = new Date('2026-07-15T12:00:00.000Z')

const fetchMock = vi.fn()

function calendarRequestCount(): number {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).startsWith('/api/v1/pro/calendar?'),
  ).length
}

function ping(): void {
  act(() => {
    mocks.onChanged.current?.()
  })
}

function inProShell(children: ReactNode) {
  return <LiveRefresh channels={['pro:pro_1', 'user:usr_pro']}>{children}</LiveRefresh>
}

describe('pro calendar — live-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onChanged.current = null

    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)

      if (url.startsWith('/api/v1/pro/locations')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ locations: [LOCATION] }),
        }
      }

      if (url.startsWith('/api/v1/pro/working-hours')) {
        return { ok: true, status: 200, json: async () => ({ workingHours: null }) }
      }

      return { ok: true, status: 200, json: async () => calendarPayload() }
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  it('refetches the calendar when a client decision pings the pro shell', async () => {
    renderHook(() => useCalendarData({ view: 'week', currentDate: CURRENT_DATE }), {
      wrapper: ({ children }) => inProShell(children),
    })

    await waitFor(() => {
      expect(calendarRequestCount()).toBe(1)
    })

    // The client just approved the consultation.
    ping()

    await waitFor(() => {
      expect(calendarRequestCount()).toBe(2)
    })
  })

  it('does not refetch without a ping (no accidental poll loop)', async () => {
    renderHook(() => useCalendarData({ view: 'week', currentDate: CURRENT_DATE }), {
      wrapper: ({ children }) => inProShell(children),
    })

    await waitFor(() => {
      expect(calendarRequestCount()).toBe(1)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(calendarRequestCount()).toBe(1)
  })

  it('still loads normally with no live boundary above (Realtime unconfigured)', async () => {
    // Degrade-gracefully: the calendar must not depend on the subscription
    // existing — it just loses the instant refresh.
    renderHook(() => useCalendarData({ view: 'week', currentDate: CURRENT_DATE }))

    await waitFor(() => {
      expect(calendarRequestCount()).toBe(1)
    })
  })

  it('stops refetching once the calendar unmounts', async () => {
    const { unmount } = render(
      inProShell(<CalendarProbe />),
    )

    await waitFor(() => {
      expect(calendarRequestCount()).toBe(1)
    })

    unmount()
    ping()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(calendarRequestCount()).toBe(1)
  })
})

function CalendarProbe() {
  useCalendarData({ view: 'week', currentDate: CURRENT_DATE })

  return null
}
