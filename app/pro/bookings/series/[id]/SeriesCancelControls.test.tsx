// app/pro/bookings/series/[id]/SeriesCancelControls.test.tsx
//
// K19 — the confirmation panel that stands between a pro and an irreversible
// bulk cancel.
//
// What is worth pinning here is not that the button posts. It is that BEFORE it
// posts, the panel names the rows it will take, the rows it will leave, and the
// money it will not refund — the three things a `window.confirm` cannot carry
// and a headless browser could never have exercised anyway
// ([[headless-dialog-autodismiss]]).
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ProBookingSeriesDetailDTO } from '@/lib/dto/proBookingSeries'

import SeriesCancelControls from './SeriesCancelControls'

const mocks = vi.hoisted(() => ({ useRouter: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: mocks.useRouter }))

const ZONE = 'America/Los_Angeles'

// Fixed clock: the fixture's dates straddle it, so "in the past" is a fact
// about the data rather than about the day the suite happens to run.
const NOW = new Date('2026-09-01T17:00:00.000Z')

function occurrence(
  index: number,
  overrides: Partial<ProBookingSeriesDetailDTO['occurrences'][number]> = {},
): ProBookingSeriesDetailDTO['occurrences'][number] {
  return {
    index,
    bookingId: `bkg_${index}`,
    scheduledFor: new Date(
      NOW.getTime() + (index + 1) * 7 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    status: 'ACCEPTED',
    startedAt: null,
    bookedTotalCents: 12_000,
    depositHeldCents: 0,
    cancellable: true,
    untouchedReason: null,
    ...overrides,
  }
}

function detail(
  overrides: Partial<ProBookingSeriesDetailDTO> = {},
): ProBookingSeriesDetailDTO {
  return {
    seriesId: 'ser_1',
    status: 'ACTIVE',
    timeZone: ZONE,
    anchorAt: NOW.toISOString(),
    intervalWeeks: 1,
    occurrenceCount: 4,
    nextOccurrenceIndex: 4,
    depositRequested: false,
    depositPerOccurrence: false,
    clientId: 'cli_1',
    clientName: 'Dana West',
    offeringId: 'off_1',
    serviceName: 'Balayage',
    locationId: 'loc_1',
    locationLabel: 'Salon • 1 Main St',
    locationType: 'SALON',
    addOnNames: [],
    internalNotes: null,
    pricing: {
      pinnedTotalCents: 12_000,
      currentListTotalCents: 12_000,
      occurrencesDisagree: false,
      listPriceMoved: false,
    },
    occurrences: [occurrence(0), occurrence(1), occurrence(2), occurrence(3)],
    skipped: [],
    ...overrides,
  }
}

describe('SeriesCancelControls', () => {
  const refresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    mocks.useRouter.mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      refresh,
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('previews exactly which appointments a THIS_AND_FUTURE cancel takes and leaves', async () => {
    const user = userEvent.setup()
    render(<SeriesCancelControls series={detail()} />)

    await user.click(screen.getByTestId('series-cancel-from-2'))

    const panel = screen.getByTestId('series-cancel-confirm')
    expect(panel).toHaveTextContent('2 appointments will be cancelled')

    // 🔴 The half that matters: the rows it will NOT touch, named, with the
    // reason. A panel that only counts the casualties is the same defect as a
    // create screen that renders only `occurrences`.
    const keep = within(panel).getByTestId('series-cancel-keep')
    expect(keep.children).toHaveLength(2)
    expect(keep).toHaveTextContent(/Earlier than this one/)
  })

  it('warns about deposits it will not refund', async () => {
    const user = userEvent.setup()
    render(
      <SeriesCancelControls
        series={detail({
          occurrences: [
            occurrence(0, { depositHeldCents: 4_000 }),
            occurrence(1, { depositHeldCents: 4_000 }),
          ],
        })}
      />,
    )

    await user.click(screen.getByTestId('series-cancel-all'))

    expect(screen.getByTestId('series-cancel-confirm')).toHaveTextContent(
      /You are holding \$80\.00 in deposits/,
    )
  })

  it('says nothing about deposits when none are held', async () => {
    const user = userEvent.setup()
    render(<SeriesCancelControls series={detail()} />)

    await user.click(screen.getByTestId('series-cancel-all'))

    expect(screen.getByTestId('series-cancel-confirm')).not.toHaveTextContent(
      /in deposits/,
    )
  })

  it('posts the chosen scope only after the pro confirms', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ seriesId: 'ser_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    render(<SeriesCancelControls series={detail()} />)

    await user.click(screen.getByTestId('series-cancel-from-2'))
    expect(fetch).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('series-cancel-confirm-submit'))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? []
    expect(String(url)).toBe('/api/v1/pro/booking-series/ser_1/cancel')
    expect(JSON.parse(String((init as RequestInit)?.body ?? '{}'))).toEqual({
      scope: 'THIS_AND_FUTURE',
      fromOccurrenceIndex: 2,
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('offers no cancel at all once nothing is cancellable', () => {
    render(
      <SeriesCancelControls
        series={detail({
          occurrences: [
            occurrence(0, {
              status: 'CANCELLED',
              cancellable: false,
              untouchedReason: 'ALREADY_CANCELLED',
            }),
          ],
        })}
      />,
    )

    expect(screen.queryByTestId('series-cancel-all')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('series-cancel-from-0'),
    ).not.toBeInTheDocument()

    // The status badge already says it. Printing "· Already cancelled" beside a
    // "Cancelled" badge is the same fact twice.
    const row = screen.getByTestId('series-occurrence-0')
    expect(row).toHaveTextContent(/Cancelled/)
    expect(row).not.toHaveTextContent(/Already cancelled/)
  })

  // IN_PAST is the one reason the badge cannot carry: the row still reads
  // "Confirmed", and without the note a pro would wonder why it has no button.
  it('does print the reason a past occurrence has no cancel button', () => {
    render(
      <SeriesCancelControls
        series={detail({
          occurrences: [
            occurrence(0, {
              scheduledFor: new Date(
                NOW.getTime() - 7 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              cancellable: false,
              untouchedReason: 'IN_PAST',
            }),
          ],
        })}
      />,
    )

    const row = screen.getByTestId('series-occurrence-0')
    expect(row).toHaveTextContent(/Confirmed/)
    expect(row).toHaveTextContent(/In the past/)
  })
})
