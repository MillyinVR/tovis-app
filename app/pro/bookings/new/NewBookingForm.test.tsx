// app/pro/bookings/new/NewBookingForm.test.tsx
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import type {
  ProBookingNewClientDTO,
  ProBookingNewOfferingDTO,
} from '@/lib/dto/proBookingNew'

import NewBookingForm from './NewBookingForm'

const mocks = vi.hoisted(() => ({
  useRouter: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: mocks.useRouter,
}))

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const client: ProBookingNewClientDTO = {
  id: 'cli_1',
  firstName: 'Dana',
  lastName: 'West',
  phone: null,
  avatarUrl: null,
  dateOfBirth: null,
  user: {
    id: 'usr_1',
    email: 'dana@example.com',
    role: 'CLIENT',
    phone: null,
    phoneVerifiedAt: null,
  },
}

const offering: ProBookingNewOfferingDTO = {
  id: 'off_1',
  title: 'Balayage',
  description: null,
  salonPriceStartingAt: 200,
  salonDurationMinutes: 60,
  mobilePriceStartingAt: null,
  mobileDurationMinutes: null,
  offersInSalon: true,
  offersMobile: false,
  customImageUrl: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  service: {
    id: 'svc_1',
    name: 'Color',
    categoryId: 'cat_1',
    description: null,
    defaultDurationMinutes: 60,
    minPrice: 200,
    defaultImageUrl: null,
    allowMobile: false,
    isActive: true,
    isAddOnEligible: false,
    addOnGroup: null,
    category: { id: 'cat_1', name: 'Hair' },
  },
}

const baseProps = {
  professionalId: 'pro_1',
  clients: [client],
  offerings: [offering],
  locations: [
    {
      id: 'loc_1',
      label: 'Studio',
      type: 'SALON' as const,
      isBookable: true,
      isPrimary: true,
      timeZone: 'America/New_York',
    },
  ],
  clientAddressesByClientId: {},
  defaultClientId: 'cli_1',
  defaultOfferingId: 'off_1',
  defaultLocationId: 'loc_1',
  defaultLocationType: 'SALON' as const,
  // A prefilled time opens the form straight in custom mode — the manual-time
  // path where a pro can enter an overlapping slot. 13:00 New York = 17:00 UTC.
  defaultScheduledAt: '2026-07-15T13:00',
}

// Route each effect's fetch by URL so the calendar-overlap check gets its
// events while the add-on / service-address effects stay quiet.
function routeFetch(calendarBody: unknown) {
  return (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/api/v1/pro/calendar')) {
      return Promise.resolve(jsonResponse(200, calendarBody))
    }
    if (url.includes('/offerings/add-ons')) {
      return Promise.resolve(jsonResponse(200, { addOns: [] }))
    }
    if (url.includes('/service-addresses')) {
      return Promise.resolve(jsonResponse(200, { addresses: [] }))
    }
    return Promise.resolve(jsonResponse(200, {}))
  }
}

describe('NewBookingForm passive double-book warning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useRouter.mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      refresh: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('warns "This overlaps {client}" when the picked time collides', async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetch({
        events: [
          {
            id: 'bkg_x',
            kind: 'BOOKING',
            // 17:30–18:30 UTC overlaps the proposed 17:00–18:00 UTC window.
            startsAt: '2026-07-15T17:30:00.000Z',
            endsAt: '2026-07-15T18:30:00.000Z',
            clientName: 'Sam Rivera',
          },
        ],
      }),
    )

    render(<NewBookingForm {...baseProps} />)

    await waitFor(() => {
      expect(screen.getByText(/This overlaps Sam Rivera/i)).toBeInTheDocument()
    })

    // The proposed booking's location scopes the calendar fetch.
    const calendarCall = vi
      .mocked(fetch)
      .mock.calls.map((call) => String(call[0]))
      .find((url) => url.includes('/api/v1/pro/calendar'))
    expect(calendarCall).toBeTruthy()
    const url = new URL(String(calendarCall), 'http://x')
    expect(url.searchParams.get('locationId')).toBe('loc_1')
    expect(url.searchParams.get('from')).toBeTruthy()
    expect(url.searchParams.get('to')).toBeTruthy()
  })

  it('stays silent when nothing overlaps the picked time', async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetch({
        events: [
          {
            id: 'bkg_y',
            kind: 'BOOKING',
            // 19:00–20:00 UTC is clear of the proposed 17:00–18:00 UTC window.
            startsAt: '2026-07-15T19:00:00.000Z',
            endsAt: '2026-07-15T20:00:00.000Z',
            clientName: 'Jordan Lee',
          },
        ],
      }),
    )

    render(<NewBookingForm {...baseProps} />)

    // Let the debounced calendar fetch resolve, then assert no note appeared.
    await waitFor(() => {
      const called = vi
        .mocked(fetch)
        .mock.calls.some((call) => String(call[0]).includes('/pro/calendar'))
      expect(called).toBe(true)
    })
    await waitFor(() => {
      expect(screen.queryByText(/This overlaps/i)).not.toBeInTheDocument()
    })
  })

  it('does not warn on a BLOCK-kind overlap (the pro’s own blocked time)', async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetch({
        events: [
          {
            id: 'block:blk_1',
            kind: 'BLOCK',
            startsAt: '2026-07-15T17:30:00.000Z',
            endsAt: '2026-07-15T18:30:00.000Z',
            clientName: 'Personal',
          },
        ],
      }),
    )

    render(<NewBookingForm {...baseProps} />)

    await waitFor(() => {
      const called = vi
        .mocked(fetch)
        .mock.calls.some((call) => String(call[0]).includes('/pro/calendar'))
      expect(called).toBe(true)
    })
    await waitFor(() => {
      expect(screen.queryByText(/This overlaps/i)).not.toBeInTheDocument()
    })
  })
})
