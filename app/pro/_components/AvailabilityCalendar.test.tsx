import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AvailabilityCalendar from './AvailabilityCalendar'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('AvailabilityCalendar', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the month, overlays booked/blocked days, and returns the picked day', async () => {
    const fetchMock = vi.fn(() =>
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
      <AvailabilityCalendar
        open
        tz="America/Los_Angeles"
        anchorYmd="2099-09-15"
        onClose={onClose}
        onPick={onPick}
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/pro/availability/busy-days?from=2099-09-01&to=2099-09-30',
      ),
      expect.objectContaining({ cache: 'no-store' }),
    )

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
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ok: true, tz: 'UTC', days: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onPick = vi.fn()

    render(
      <AvailabilityCalendar
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
      <AvailabilityCalendar
        open={false}
        tz="UTC"
        onClose={vi.fn()}
        onPick={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('steps the selection ahead a week at a time via the jump chips, without closing', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ok: true, tz: 'UTC', days: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onPick = vi.fn()
    const onClose = vi.fn()

    render(
      <AvailabilityCalendar
        open
        tz="UTC"
        anchorYmd="2099-09-15"
        selectedYmd="2099-09-15"
        onClose={onClose}
        onPick={onPick}
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    // Each chip steps FROM the selected day; none of them close the popup, so
    // the pro can keep skipping ahead.
    fireEvent.click(screen.getByRole('button', { name: 'Skip ahead 1 week' }))
    expect(onPick).toHaveBeenCalledWith('2099-09-22')

    fireEvent.click(screen.getByRole('button', { name: 'Skip ahead 2 weeks' }))
    expect(onPick).toHaveBeenCalledWith('2099-09-29')

    fireEvent.click(screen.getByRole('button', { name: 'Skip ahead 4 weeks' }))
    expect(onPick).toHaveBeenCalledWith('2099-10-13')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers a Suggested chip when a selectable suggested day is provided', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ok: true, tz: 'UTC', days: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onPick = vi.fn()

    const { rerender } = render(
      <AvailabilityCalendar
        open
        tz="UTC"
        anchorYmd="2099-09-15"
        suggestedYmd="2099-10-01"
        onClose={vi.fn()}
        onPick={onPick}
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    fireEvent.click(
      screen.getByRole('button', { name: 'Jump to the suggested rebook date' }),
    )
    expect(onPick).toHaveBeenCalledWith('2099-10-01')

    // A suggestion in the past is stale — the chip disappears instead of
    // offering an unselectable day.
    rerender(
      <AvailabilityCalendar
        open
        tz="UTC"
        anchorYmd="2099-09-15"
        suggestedYmd="2001-01-01"
        onClose={vi.fn()}
        onPick={onPick}
      />,
    )
    expect(
      screen.queryByRole('button', {
        name: 'Jump to the suggested rebook date',
      }),
    ).not.toBeInTheDocument()
  })

  it('inline variant renders the bare card with the selected day highlighted and keeps picks open', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ok: true, tz: 'UTC', days: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onPick = vi.fn()

    render(
      <AvailabilityCalendar
        open
        variant="inline"
        tz="UTC"
        anchorYmd="2099-09-15"
        selectedYmd="2099-09-15"
        onPick={onPick}
      />,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    // No modal chrome inline: no dialog role, no close button.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument()

    // The chosen day is marked selected.
    expect(screen.getByText('15').closest('button')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Picking another day emits it and the calendar stays mounted.
    fireEvent.click(screen.getByText('20'))
    expect(onPick).toHaveBeenCalledWith('2099-09-20')
    expect(screen.getByText('September 2099')).toBeInTheDocument()
  })

  it('follows the selection to its month when the selected day changes', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ok: true, tz: 'UTC', days: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(
      <AvailabilityCalendar
        open
        variant="inline"
        tz="UTC"
        selectedYmd="2099-09-15"
        onPick={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('September 2099')).toBeInTheDocument(),
    )

    // A jump/step/typed date lands in another month — the grid follows.
    rerender(
      <AvailabilityCalendar
        open
        variant="inline"
        tz="UTC"
        selectedYmd="2099-11-03"
        onPick={vi.fn()}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText('November 2099')).toBeInTheDocument(),
    )
  })

  it('disables every control when disabled', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ok: true, tz: 'UTC', days: {} })),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <AvailabilityCalendar
        open
        variant="inline"
        tz="UTC"
        selectedYmd="2099-09-15"
        suggestedYmd="2099-10-01"
        disabled
        onPick={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('September 2099')).toBeInTheDocument(),
    )

    expect(screen.getByRole('button', { name: 'Skip ahead 1 week' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Jump to the suggested rebook date' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    expect(screen.getByText('20').closest('button')).toBeDisabled()
  })
})
