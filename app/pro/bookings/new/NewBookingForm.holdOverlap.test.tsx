// app/pro/bookings/new/NewBookingForm.holdOverlap.test.tsx
//
// The pro's live-hold decision, end to end through the booking form
// (B5 follow-up, Tori 2026-08-28).
//
// The dialog's own rendering is covered by
// `app/pro/_components/HoldOverlapDecisionDialog.test.tsx`. What is pinned here
// is the FLOW the form owns, which is where the two ways of getting this wrong
// live: "book it anyway" has to actually re-submit with the confirmation (a
// rendered button with no handler is a shipped feature that does nothing), and
// "wait" has to abandon the attempt without writing anything.

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
  push: vi.fn(),
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
  // 13:00 New York = 17:00 UTC. Custom-time mode, the path a pro types into.
  defaultScheduledAt: '2026-07-15T13:00',
}

/**
 * The server's refusal-that-is-really-a-question, exactly as
 * `bookingErrorJsonFail` serializes it.
 */
function holdDecisionResponse(
  overrides: Record<string, unknown> = {},
): Response {
  return jsonResponse(409, {
    ok: false,
    error:
      'A client is checking out for this time right now. Choose whether to book over them.',
    code: 'HOLD_OVERLAP_NEEDS_CONFIRMATION',
    retryable: false,
    uiAction: 'NONE',
    message: 'A live client hold covers this time.',
    heldSlot: {
      holdId: 'hold_1',
      relationship: 'RETURNING',
      serviceName: 'Signature Manicure',
      startsAt: '2026-07-15T17:00:00.000Z',
      endsAt: '2026-07-15T18:15:00.000Z',
      expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
      additionalHeldSlots: 0,
      ...overrides,
    },
  })
}

/** Every POST body sent to the pro booking create route, parsed. */
function createBodies(): Array<Record<string, unknown>> {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([input, init]) => {
      const url = String(input instanceof Request ? input.url : input)
      return url.includes('/api/v1/pro/bookings') && init?.method === 'POST'
    })
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

/** Every Idempotency-Key header those POSTs carried. */
function createKeys(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([input, init]) => {
      const url = String(input instanceof Request ? input.url : input)
      return url.includes('/api/v1/pro/bookings') && init?.method === 'POST'
    })
    .map(([, init]) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      return headers['Idempotency-Key'] ?? ''
    })
}

/**
 * Answers every effect fetch quietly and hands the POST whatever the test
 * queued, in order.
 */
function routeFetch(postResponses: Response[]) {
  const queue = [...postResponses]

  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)

    if (url.includes('/api/v1/pro/bookings') && init?.method === 'POST') {
      const next = queue.shift()
      if (!next) throw new Error('unexpected extra POST')
      return Promise.resolve(next)
    }

    if (url.includes('/api/v1/pro/calendar')) {
      return Promise.resolve(jsonResponse(200, { events: [] }))
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

async function submitAndMeetTheHold(postResponses: Response[]) {
  const user = userEvent.setup()

  vi.mocked(fetch).mockImplementation(routeFetch(postResponses))

  render(<NewBookingForm {...baseProps} />)

  await user.click(screen.getByRole('button', { name: /create booking/i }))

  await waitFor(() => {
    expect(screen.getByTestId('hold-overlap-decision')).toBeInTheDocument()
  })

  return user
}

const createdResponse = jsonResponse(201, {
  ok: true,
  booking: { id: 'bkg_new_1' },
})

describe('NewBookingForm — the live-hold decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useRouter.mockReturnValue({
      push: mocks.push,
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

  it('turns the refusal into the decision instead of a dead-end error', async () => {
    await submitAndMeetTheHold([holdDecisionResponse()])

    const dialog = screen.getByTestId('hold-overlap-decision')

    expect(dialog.textContent).toContain('A returning client is booking')
    expect(dialog.textContent).toContain('Signature Manicure')

    // The raw refusal copy must NOT also land in the form's error banner —
    // that would read as a failure beside a dialog asking a question.
    expect(
      screen.queryByText(/Choose whether to book over them/i),
    ).not.toBeInTheDocument()

    // The first attempt did NOT carry the confirmation. If it had, the server
    // would have booked over the checkout without ever asking.
    const [first] = createBodies()
    expect(first?.confirmHoldOverlap).toBeUndefined()
  })

  it('re-submits WITH the confirmation when the pro books anyway', async () => {
    const user = await submitAndMeetTheHold([
      holdDecisionResponse(),
      createdResponse,
    ])

    await user.click(screen.getByRole('button', { name: /book it anyway/i }))

    await waitFor(() => {
      expect(createBodies()).toHaveLength(2)
    })

    const [first, second] = createBodies()
    expect(first?.confirmHoldOverlap).toBeUndefined()
    expect(second?.confirmHoldOverlap).toBe(true)

    // Everything else about the request is the SAME booking — the pro answered
    // a question, they did not edit the form.
    expect(second?.scheduledFor).toBe(first?.scheduledFor)
    expect(second?.offeringId).toBe(first?.offeringId)

    // 🔴 A fresh idempotency key, or the ledger 409s the retry as "same key,
    // different body" and the pro's answer never reaches the write.
    const [firstKey, secondKey] = createKeys()
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBeTruthy()
    expect(secondKey).not.toBe(firstKey)

    // ...and the booking really was created.
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/pro/bookings/bkg_new_1')
    })
  })

  it('abandons the attempt when the pro chooses to wait', async () => {
    const user = await submitAndMeetTheHold([holdDecisionResponse()])

    await user.click(screen.getByRole('button', { name: /wait for them/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('hold-overlap-decision')).not.toBeInTheDocument()
    })

    // No second POST, no navigation, no error banner — the attempt is simply
    // over, and the form keeps what the pro typed so they can try again later.
    expect(createBodies()).toHaveLength(1)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /create booking/i }),
    ).toBeInTheDocument()
  })

  // The guard against an infinite popup: if the server somehow asks twice, the
  // second refusal is shown as an ordinary error rather than trapping the pro
  // in a dialog they have already answered.
  it('does not re-open the dialog after the pro has already answered', async () => {
    const user = await submitAndMeetTheHold([
      holdDecisionResponse(),
      holdDecisionResponse(),
    ])

    await user.click(screen.getByRole('button', { name: /book it anyway/i }))

    await waitFor(() => {
      expect(createBodies()).toHaveLength(2)
    })

    await waitFor(() => {
      expect(
        screen.queryByTestId('hold-overlap-decision'),
      ).not.toBeInTheDocument()
    })

    expect(
      screen.getByText(/Choose whether to book over them/i),
    ).toBeInTheDocument()
  })

  // 🔴 Nothing person-shaped may reach the page, not just the dialog: a wire
  // field the form happened to render elsewhere would be the same leak.
  it('never puts the held client on the page', async () => {
    const { container } = render(<div />)
    void container

    await submitAndMeetTheHold([
      holdDecisionResponse({ relationship: 'NEW' }),
    ])

    const page = document.body.innerHTML

    for (const secret of [
      'Marguerite',
      'marguerite@example.com',
      '+15558675309',
      'hold_1_client',
    ]) {
      expect(page).not.toContain(secret)
    }

    // The one thing it DOES say about them.
    expect(screen.getByTestId('hold-overlap-summary').textContent).toContain(
      'A new client is booking',
    )
  })
})
