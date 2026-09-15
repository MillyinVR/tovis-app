import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DaySchedulePanel from './DaySchedulePanel'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// UTC keeps the fixtures' wall clock readable; the zone logic itself is covered
// by lib/booking/dateTime's own suite.
const TZ = 'UTC'

describe('DaySchedulePanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('asks for the selected day only, across ALL locations', async () => {
    const urls: string[] = []
    const fetchMock = vi.fn((input: unknown) => {
      urls.push(String(input))
      return Promise.resolve(jsonResponse({ ok: true, events: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DaySchedulePanel ymd="2099-09-15" timeZone={TZ} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const url = urls[0] ?? ''
    expect(url).toContain('/api/v1/pro/calendar?')
    // A day EARLIER than the day shown: the feed filters bookings on their
    // START, so a window opening at this day's 00:00 would miss an appointment
    // that began last night and runs past midnight.
    expect(url).toContain(`from=${encodeURIComponent('2099-09-14T00:00:00.000Z')}`)
    expect(url).toContain(`to=${encodeURIComponent('2099-09-16T00:00:00.000Z')}`)
    // 🔴 The overlap constraint has no location term — a filtered feed would
    // show free time another location already owns.
    expect(url).toContain('scope=ALL')
  })

  it('shows the time, who, and what for each thing on the day', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            ok: true,
            events: [
              {
                id: 'block:b1',
                kind: 'BLOCK',
                startsAt: '2099-09-15T16:00:00.000Z',
                endsAt: '2099-09-15T17:00:00.000Z',
                title: 'School run',
                clientName: 'Personal',
                status: 'BLOCKED',
              },
              {
                id: 'bk_1',
                kind: 'BOOKING',
                startsAt: '2099-09-15T14:00:00.000Z',
                endsAt: '2099-09-15T15:30:00.000Z',
                title: 'Silk press',
                clientName: 'Sam Rivers',
                status: 'ACCEPTED',
              },
            ],
          }),
        ),
      ),
    )

    render(<DaySchedulePanel ymd="2099-09-15" timeZone={TZ} />)

    // The booking sorts ahead of the later block, and each row names a time.
    await waitFor(() => expect(screen.getByText('Sam Rivers')).toBeInTheDocument())
    expect(screen.getByText('Silk press')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('2:00 PM – 3:30 PM')).toBeInTheDocument()

    expect(screen.getByText('School run')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText('4:00 PM – 5:00 PM')).toBeInTheDocument()

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Sam Rivers')
    expect(rows[1]).toHaveTextContent('School run')
  })

  it('shows an appointment that spilled in from the night before', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            ok: true,
            events: [
              {
                id: 'bk_overnight',
                kind: 'BOOKING',
                // Started yesterday evening, still running at this day's 00:00.
                startsAt: '2099-09-14T22:00:00.000Z',
                endsAt: '2099-09-15T01:30:00.000Z',
                title: 'Braids',
                clientName: 'Nia Okafor',
                status: 'ACCEPTED',
              },
            ],
          }),
        ),
      ),
    )

    render(<DaySchedulePanel ymd="2099-09-15" timeZone={TZ} />)

    await waitFor(() => expect(screen.getByText('Nia Okafor')).toBeInTheDocument())
    // Clipped to THIS day: there is no honest start time to print for it here.
    expect(screen.getByText('… – 1:30 AM')).toBeInTheDocument()
  })

  it('says the day is clear rather than staying silent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ ok: true, events: [] }))),
    )

    render(<DaySchedulePanel ymd="2099-09-15" timeZone={TZ} />)

    await waitFor(() =>
      expect(screen.getByText('Nothing on this day yet.')).toBeInTheDocument(),
    )
  })

  it('tells the pro to check their calendar when the day cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ error: 'nope' }, 500))),
    )

    render(<DaySchedulePanel ymd="2099-09-15" timeZone={TZ} />)

    await waitFor(() =>
      expect(screen.getByText(/Couldn’t load that day’s schedule/)).toBeInTheDocument(),
    )
  })

  it('never shows one day’s rows under another day’s heading', async () => {
    const fetchMock = vi.fn((input: unknown) =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          // Discriminate on `to` — the exclusive END of the day asked for. The
          // `from` is a day earlier, so it would match both requests.
          events: String(input).includes(encodeURIComponent('2099-09-16T00:00:00.000Z'))
            ? [
                {
                  id: 'bk_1',
                  kind: 'BOOKING',
                  startsAt: '2099-09-15T14:00:00.000Z',
                  endsAt: '2099-09-15T15:00:00.000Z',
                  title: 'Silk press',
                  clientName: 'Sam Rivers',
                  status: 'ACCEPTED',
                },
              ]
            : [],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<DaySchedulePanel ymd="2099-09-15" timeZone={TZ} />)
    await waitFor(() => expect(screen.getByText('Sam Rivers')).toBeInTheDocument())

    rerender(<DaySchedulePanel ymd="2099-09-16" timeZone={TZ} />)

    // The settled answer is tagged with the day it answers for, so the moment
    // the selection moves the old rows are gone — not left standing under the
    // new date while the next request is in flight.
    expect(screen.queryByText('Sam Rivers')).not.toBeInTheDocument()
    expect(screen.getByText('Loading your day…')).toBeInTheDocument()

    await waitFor(() =>
      expect(screen.getByText('Nothing on this day yet.')).toBeInTheDocument(),
    )
  })

  it('says so when the day itself cannot be resolved', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<DaySchedulePanel ymd="not-a-date" timeZone={TZ} />)

    expect(screen.getByText(/Couldn’t load that day’s schedule/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fires one request when the pro taps skip-ahead several times', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ok: true, events: [] })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<DaySchedulePanel ymd="2099-09-15" timeZone={TZ} />)
    rerender(<DaySchedulePanel ymd="2099-09-22" timeZone={TZ} />)
    rerender(<DaySchedulePanel ymd="2099-09-29" timeZone={TZ} />)
    rerender(<DaySchedulePanel ymd="2099-10-06" timeZone={TZ} />)

    // "+1w" four times is one intention, not four feed reads.
    await waitFor(() =>
      expect(screen.getByText('Nothing on this day yet.')).toBeInTheDocument(),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renders nothing until a day is picked', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<DaySchedulePanel ymd={null} timeZone={TZ} />)

    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
