import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BookingServiceItemType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}))

import ConsultationForm, { type ConsultationInitialItem } from './ConsultationForm'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeInitialItem(): ConsultationInitialItem {
  return {
    key: 'bsi_1',
    bookingServiceItemId: 'bsi_1',
    serviceId: 'svc_1',
    offeringId: 'off_1',
    itemType: BookingServiceItemType.BASE,
    label: 'Silk Press',
    categoryName: null,
    price: '120.00',
    durationMinutes: '90',
    notes: '',
    sortOrder: 0,
    source: 'BOOKING',
  }
}

/** The F12 half of the propose response. */
function scheduleBody(overrides?: {
  outlook?: string
  timeZone?: string | null
  endsAt?: string
}) {
  return {
    approval: { id: 'approval_1' },
    consultationActionDelivery: { attempted: true, queued: true, href: '/x' },
    schedule: {
      // 2026-04-14T01:15Z is 18:15 in America/Los_Angeles.
      endsAt: overrides?.endsAt ?? '2026-04-14T01:15:00.000Z',
      durationMinutes: 120,
      bufferMinutes: 10,
      timeZone:
        overrides && 'timeZone' in overrides
          ? overrides.timeZone
          : 'America/Los_Angeles',
      outlook: overrides?.outlook ?? 'WITHIN_WORKING_HOURS',
    },
  }
}

async function sendProposal(): Promise<void> {
  render(
    <ConsultationForm
      bookingId="booking_1"
      initialNotes=""
      initialPrice={null}
      initialItems={[makeInitialItem()]}
    />,
  )

  fireEvent.click(
    screen.getByRole('button', { name: /send to client for approval/i }),
  )
}

describe('ConsultationForm — F12 schedule notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    // The services picker load; irrelevant to these assertions.
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { services: [] }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('tells the pro when these services push the end past working hours', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { services: [] }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, scheduleBody({ outlook: 'PAST_WORKING_HOURS' })),
    )

    await sendProposal()

    const notice = await waitFor(() =>
      screen.getByText(/runs to 6:15\s?PM — past your working hours/i),
    )

    // A caution, not a success and not a failure: the send WORKED. Rendering it
    // green would say "all good" about the one thing the pro needs to notice.
    expect(notice.className).toContain('brand-pro-session-notice')
    expect(notice.className).not.toContain('brand-pro-session-success')

    // Navigating flips the page to "Waiting on client" and unmounts this form,
    // which would take the notice with it. So it must NOT navigate.
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('ALLOWS the ordinary send to navigate away, saying nothing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { services: [] }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, scheduleBody({ outlook: 'WITHIN_WORKING_HOURS' })),
    )

    await sendProposal()

    await waitFor(() => {
      expect(screen.getByText('Sent to client for approval.')).toBeTruthy()
    })

    expect(mocks.push).toHaveBeenCalledWith('/pro/bookings/booking_1/session')
    expect(screen.queryByText(/working hours/i)).toBeNull()
  })

  it('ALLOWS a send on an appointment that was already running late, saying nothing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { services: [] }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        200,
        scheduleBody({ outlook: 'ALREADY_OUTSIDE_WORKING_HOURS' }),
      ),
    )

    await sendProposal()

    await waitFor(() => {
      expect(screen.getByText('Sent to client for approval.')).toBeTruthy()
    })

    expect(mocks.push).toHaveBeenCalled()
  })

  it('never reports an unanswered question as a problem', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { services: [] }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, scheduleBody({ outlook: 'NOT_CHECKED', timeZone: null })),
    )

    await sendProposal()

    await waitFor(() => {
      expect(screen.getByText('Sent to client for approval.')).toBeTruthy()
    })
  })

  it('drops the clock when the server could not resolve a time zone', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { services: [] }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        200,
        scheduleBody({ outlook: 'PAST_WORKING_HOURS', timeZone: null }),
      ),
    )

    await sendProposal()

    await waitFor(() => {
      expect(
        screen.getByText(
          'Sent. With these services the appointment now runs past your working hours.',
        ),
      ).toBeTruthy()
    })

    // A wall clock rendered in the BROWSER's zone would be a lie about the
    // appointment's, so no time is shown at all.
    expect(screen.queryByText(/runs to /i)).toBeNull()
  })

  it('shows the block refusal the server sends, and stays put', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { services: [] }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(409, {
        ok: false,
        error:
          'These services run past this appointment into time you’ve blocked off. Clear the block or trim the proposal, then send again.',
        code: 'TIME_BLOCKED',
        uiAction: 'NONE',
      }),
    )

    await sendProposal()

    await waitFor(() => {
      expect(screen.getByText(/into time you’ve blocked off/i)).toBeTruthy()
    })

    expect(mocks.push).not.toHaveBeenCalled()
  })
})
