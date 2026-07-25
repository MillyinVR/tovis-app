import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AvailabilityCalendarPopup from './AvailabilityCalendarPopup'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('AvailabilityCalendarPopup', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the month, overlays booked/blocked days, and returns the picked day', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          tz: 'America/Los_Angeles',
          days: {
            // Far-future month so every day is selectable regardless of "today".
            '2099-09-10': { bookings: 2, blocked: false },
            '2099-09-15': { bookings: 0, blocked: true },
          },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onPick = vi.fn()
    const onClose = vi.fn()

    render(
      <AvailabilityCalendarPopup
        open
        tz="America/Los_Angeles"
        anchorYmd="2099-09-15"
        onClose={onClose}
        onPick={onPick}
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const url = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(url).toContain('/api/v1/pro/availability/busy-days')
    expect(url).toContain('from=2099-09-01')
    expect(url).toContain('to=2099-09-30')

    expect(screen.getByText('September 2099')).toBeInTheDocument()

    // Booked day carries a booking-count title; blocked day is marked blocked.
    await waitFor(() =>
      expect(screen.getByText('10').closest('button')).toHaveAttribute(
        'title',
        '2 bookings',
      ),
    )
    expect(screen.getByText('15').closest('button')).toHaveAttribute(
      'title',
      'Time blocked',
    )

    // Picking a day returns its YYYY-MM-DD and closes.
    fireEvent.click(screen.getByText('20'))
    expect(onPick).toHaveBeenCalledWith('2099-09-20')
    expect(onClose).toHaveBeenCalled()
  })

  it('shades off days but leaves them selectable', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse({ ok: true, tz: 'UTC', days: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onPick = vi.fn()

    render(
      <AvailabilityCalendarPopup
        open
        tz="UTC"
        anchorYmd="2099-09-15"
        onClose={vi.fn()}
        onPick={onPick}
        // Saturdays off. 2099-09-05 / 12 / 19 / 26 are the month's Saturdays.
        offWeekdays={new Set([6])}
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const saturday = screen.getByText('19').closest('button')
    expect(saturday).toHaveAttribute(
      'title',
      'Off day — you can still book it',
    )
    expect(saturday).toBeEnabled()

    // The legend explains the shading.
    expect(screen.getByText('Off day')).toBeInTheDocument()

    // Picking the off day still works — booking it is the pro's call.
    fireEvent.click(screen.getByText('19'))
    expect(onPick).toHaveBeenCalledWith('2099-09-19')
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <AvailabilityCalendarPopup
        open={false}
        tz="UTC"
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
