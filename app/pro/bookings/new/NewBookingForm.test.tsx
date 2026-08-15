// app/pro/bookings/new/NewBookingForm.test.tsx
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
  prepayScope: null,
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
  // Deposits unavailable by default — these tests exercise the overlap
  // warning, not the K10-B deposit step.
  depositConfig: {
    stripeReady: false,
    depositEnabled: false,
    depositType: null,
    depositFlatAmountCents: null,
    depositPercent: null,
    releaseLeadHours: 72,
    releaseFloorHours: 24,
  },
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

    // 🔴 The check asks about EVERY location, not the one being booked. The
    // overlap it warns about is enforced on `professionalId` alone
    // (`Booking_no_active_professional_overlap` carries no location term), so a
    // location-filtered feed hides a collision the write will then refuse. This
    // used to assert `locationId=loc_1`.
    const calendarCall = vi
      .mocked(fetch)
      .mock.calls.map((call) => String(call[0]))
      .find((url) => url.includes('/api/v1/pro/calendar'))
    expect(calendarCall).toBeTruthy()
    const url = new URL(String(calendarCall), 'http://x')
    expect(url.searchParams.get('scope')).toBe('ALL')
    expect(url.searchParams.get('locationId')).toBeNull()
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

// ── K19: the "repeats" step ───────────────────────────────────────────────────
//
// Three things worth pinning, all of them about the control rather than the
// recurrence maths (which lives in lib/booking/series/schedule.test.ts):
//
//  1. the kill switch reaches the CONTROL — with the flag off there is no step
//     at all, so the pro is never offered a form the route answers 404 to;
//  2. it withholds itself when the form is in a mode the series route cannot
//     accept (inline new client), instead of offering and then failing;
//  3. turning it on changes WHICH RESOURCE is created — a different endpoint
//     and a different landing page, because the create response carries skips
//     that the booking page has nowhere to show.
describe('NewBookingForm repeats step (K19)', () => {
  const push = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useRouter.mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      refresh: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(fetch).mockImplementation(routeFetch({ events: [] }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders no repeats step at all while the feature is off', () => {
    // `recurringEnabled` defaults to false, which is the point: a caller that
    // forgets to pass the server flag gets the dark behaviour.
    render(<NewBookingForm {...baseProps} />)

    expect(screen.queryByText('Repeats')).not.toBeInTheDocument()
    expect(screen.queryByTestId('repeats-toggle')).not.toBeInTheDocument()
  })

  it('offers the step when the feature is on', () => {
    render(<NewBookingForm {...baseProps} recurringEnabled />)

    expect(screen.getByTestId('repeats-toggle')).toBeEnabled()
    expect(screen.queryByTestId('repeats-blocked')).not.toBeInTheDocument()
  })

  // The series route takes an existing client id; it has no inline
  // create-a-client payload. Offering the toggle here would be an offer the
  // server refuses.
  it('withholds the toggle for an inline new client, and says why', () => {
    render(
      <NewBookingForm
        {...baseProps}
        recurringEnabled
        defaultClientId={undefined}
        clients={[]}
      />,
    )

    expect(screen.getByTestId('repeats-toggle')).toBeDisabled()
    expect(screen.getByTestId('repeats-blocked')).toHaveTextContent(
      /saved client/i,
    )
  })

  it('posts to the SERIES route and lands on the series page', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url === '/api/v1/pro/booking-series') {
        return Promise.resolve(
          jsonResponse(201, {
            seriesId: 'ser_1',
            timeZone: 'America/New_York',
            nextOccurrenceIndex: 6,
            occurrences: [],
            skipped: [],
          }),
        )
      }
      return routeFetch({ events: [] })(input)
    })

    render(<NewBookingForm {...baseProps} recurringEnabled />)

    await user.click(screen.getByTestId('repeats-toggle'))
    await user.click(
      screen.getByRole('button', { name: /create recurring booking/i }),
    )

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
      expect(calls).toContain('/api/v1/pro/booking-series')
      expect(calls).not.toContain('/api/v1/pro/bookings')
    })

    const seriesCall = vi
      .mocked(fetch)
      .mock.calls.find((call) => String(call[0]) === '/api/v1/pro/booking-series')
    const body: unknown = JSON.parse(String(seriesCall?.[1]?.body ?? '{}'))
    expect(body).toMatchObject({
      clientId: 'cli_1',
      offeringId: 'off_1',
      intervalWeeks: 4,
      occurrenceCount: 6,
      // K18-A: the deposit is the FIRST occurrence's only until K20 can
      // stagger the pay links. The form never sends true.
      depositPerOccurrence: false,
    })

    // 🔴 The series page, never occurrence 0's booking page — the 201 can carry
    // eleven bookings and one skip, and only the series page renders the skip.
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/pro/bookings/series/ser_1')
    })
  })

  it('still posts a single booking when repeats is left off', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url === '/api/v1/pro/bookings') {
        return Promise.resolve(jsonResponse(201, { booking: { id: 'bkg_1' } }))
      }
      return routeFetch({ events: [] })(input)
    })

    render(<NewBookingForm {...baseProps} recurringEnabled />)

    await user.click(screen.getByRole('button', { name: /^create booking$/i }))

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
      expect(calls).toContain('/api/v1/pro/bookings')
      expect(calls).not.toContain('/api/v1/pro/booking-series')
    })
  })
})

// The pro-field migration put all 23 of this form's controls on the kit's
// `solid` surface. Nineteen were verified in a browser A/B against pre-migration
// `main`; these three could not be, and this is what stands in:
//
//   · `repeat-interval` / `repeat-count` sit behind ENABLE_RECURRING_APPOINTMENTS,
//     which is off in local dev, so the Repeats step never renders there.
//   · `clientAddress` needs an existing client who has a saved address, and no
//     client in the dev seed has one.
//
// That leaves exactly one of the 23 neither rendered nor pinned: the reason box
// inside BookingOverridePromptCard, which this form reaches by passing `field`
// down as `fieldClassName` and which only appears behind an override prompt.
// Its class is `${fieldClassName} min-h-16 resize-y`, so the only link not under
// test is the single line that hands the constant over.
//
// Pinned as the LITERAL shipped string rather than as `controlClassName(...)`:
// asserting against the helper would compare the helper with itself and stay
// green on exactly the restyle this exists to catch (the #914 lesson).
describe('NewBookingForm — the controls a browser pass cannot reach', () => {
  const SOLID_FIELD =
    'w-full border px-3 text-textPrimary placeholder:text-textSecondary/70 ' +
    'outline-none disabled:cursor-not-allowed disabled:opacity-60 rounded-xl ' +
    'border-surfaceGlass/10 bg-bgPrimary py-3 text-[13px]'

  const expectSolid = (el: Element | null) => {
    expect(el).toBeTruthy()
    expect(new Set((el as Element).className.split(/\s+/).filter(Boolean))).toEqual(
      new Set(SOLID_FIELD.split(' ')),
    )
  }

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('puts the repeat interval and count on the solid surface', async () => {
    const user = userEvent.setup()
    render(<NewBookingForm {...baseProps} recurringEnabled />)

    await user.click(screen.getByTestId('repeats-toggle'))

    expectSolid(document.querySelector('#repeat-interval'))
    expectSolid(document.querySelector('#repeat-count'))
  })

  it('puts the saved-address select on the solid surface', async () => {
    const user = userEvent.setup()
    render(
      <NewBookingForm
        {...baseProps}
        defaultLocationType="MOBILE"
        locations={[
          {
            id: 'loc_mobile',
            label: 'Mobile',
            // A pro's LOCATION is MOBILE_BASE; the SERVICE location type it
            // serves is MOBILE. Two enums, two vocabularies.
            type: 'MOBILE_BASE' as const,
            isBookable: true,
            isPrimary: true,
            timeZone: 'America/New_York',
          },
        ]}
        defaultLocationId="loc_mobile"
        clientAddressesByClientId={{
          cli_1: [
            {
              id: 'addr_1',
              label: 'Home',
              formattedAddress: '1 Test St, Brooklyn NY',
              isDefault: true,
            },
          ],
        }}
      />,
    )

    // Mobile is what reveals the service-address block; the address mode then
    // defaults to 'new', so the saved-address branch is one more click.
    await user.click(screen.getByRole('button', { name: /^Mobile/ }))
    await user.click(screen.getByRole('button', { name: /^Saved address/ }))

    expectSolid(document.querySelector('#clientAddress'))
  })
})
