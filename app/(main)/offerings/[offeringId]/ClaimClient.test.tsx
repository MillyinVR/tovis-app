// app/(main)/offerings/[offeringId]/ClaimClient.test.tsx
//
// The claim page has exactly two outcomes for a failure, and picking the wrong
// one is user-visible in both directions:
//
//   - "Someone just grabbed it" is a DEAD END. It tells the client the slot is
//     gone and points them elsewhere. Showing it for anything other than a real
//     race sends them away from an opening that is still sitting there.
//   - The inline error is RETRYABLE — the button stays. Showing it for a genuine
//     race leaves them tapping a button that can never succeed.
//
// This branched on the 409 STATUS, which conflates the two: `PRO_NOT_READY` and
// the location-config family answer 409 without anybody having raced you, and
// both are reachable when a pro's setup drifts after the opening was published.
// These tests drive the REAL component against the statuses and bodies the live
// API actually returns (captured while driving `/api/v1/holds` and
// `/api/v1/bookings/finalize` locally on 2026-07-19).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'

import ClaimClient from './ClaimClient'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const HOLD_OK = {
  ok: true,
  hold: { id: 'hold_1', scheduledFor: '2026-07-20T17:00:00.000Z' },
}

function renderClaim() {
  return render(
    <ClaimClient
      offeringId="off_1"
      openingId="opn_1"
      scheduledFor="2026-07-20T17:00:00.000Z"
      locationType="SALON"
      locationId="loc_1"
      defaultAddressId={null}
      isAuthed
      loginHref="/login"
    />,
  )
}

/** Queue of [status, body] pairs answered in order: hold first, then finalize. */
function stubFetch(...responses: Array<[number, unknown]>) {
  const queue = [...responses]
  const spy = vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected extra fetch')
    const [status, body] = next
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

async function claimAndSettle() {
  fireEvent.click(screen.getByRole('button', { name: /claim this opening/i }))
  await waitFor(() =>
    expect(screen.queryByText(/claiming…/i)).not.toBeInTheDocument(),
  )
}

const takenCard = () => screen.queryByText('Someone just grabbed it')

beforeEach(() => {
  push.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ClaimClient failure classification', () => {
  it('shows the taken card when the opening was genuinely consumed', async () => {
    // Verbatim from finalize when another client claimed the opening first.
    stubFetch(
      [200, HOLD_OK],
      [
        409,
        {
          ok: false,
          error: 'That opening was just taken. Please pick another slot.',
          code: 'OPENING_NOT_AVAILABLE',
        },
      ],
    )
    renderClaim()
    await claimAndSettle()

    expect(takenCard()).toBeInTheDocument()
  })

  // The race that actually happens. Driving two real clients against one opening
  // showed the loser fails on the HOLD with TIME_BOOKED — the winner's booking
  // now occupies the slot — and never reaches finalize at all.
  it('shows the taken card when the hold loses the race (TIME_BOOKED)', async () => {
    stubFetch([
      409,
      {
        ok: false,
        error: 'That time was just taken. Please choose another slot.',
        code: 'TIME_BOOKED',
      },
    ])
    renderClaim()
    await claimAndSettle()

    expect(takenCard()).toBeInTheDocument()
  })

  it.each(['TIME_HELD', 'TIME_BLOCKED'])(
    'shows the taken card for %s',
    async (code) => {
      stubFetch([409, { ok: false, error: 'Gone.', code }])
      renderClaim()
      await claimAndSettle()

      expect(takenCard()).toBeInTheDocument()
    },
  )

  // 🔴 The bug this file exists for. Nobody grabbed anything.
  it('does NOT claim someone grabbed it when the pro simply is not ready', async () => {
    stubFetch([
      409,
      {
        ok: false,
        error:
          'This professional is not currently accepting bookings. Please choose another provider or try again later.',
        code: 'PRO_NOT_READY',
        message: 'Professional is not ready to accept bookings: MOBILE_MISSING_BASE_CONFIG',
      },
    ])
    renderClaim()
    await claimAndSettle()

    expect(takenCard()).not.toBeInTheDocument()
    expect(
      screen.getByText(/not currently accepting bookings/i),
    ).toBeInTheDocument()
    // The internal diagnostic must not leak to the client.
    expect(screen.queryByText(/MOBILE_MISSING_BASE_CONFIG/)).not.toBeInTheDocument()
    // Still retryable — the button stays.
    expect(
      screen.getByRole('button', { name: /claim this opening/i }),
    ).toBeInTheDocument()
  })

  it.each([
    ['WORKING_HOURS_REQUIRED', 'Working hours are not set for this location.'],
    ['TIMEZONE_REQUIRED', 'This location is missing a valid timezone.'],
    ['NO_SCHEDULING_READY_LOCATION', 'No bookable location is ready.'],
  ])(
    'does NOT claim someone grabbed it for the config 409 %s',
    async (code, copy) => {
      stubFetch([409, { ok: false, error: copy, code }])
      renderClaim()
      await claimAndSettle()

      expect(takenCard()).not.toBeInTheDocument()
      expect(screen.getByText(copy)).toBeInTheDocument()
    },
  )

  // Policy refusals are 400s and carry their own readable copy. Dressing these up
  // as a race would be a lie in the other direction.
  it.each([
    ['OUTSIDE_WORKING_HOURS', 'That time is outside working hours.'],
    ['STEP_MISMATCH', 'That start time is not on a valid booking boundary.'],
    ['ADVANCE_NOTICE_REQUIRED', 'That slot is too soon. Please choose a later time.'],
  ])('surfaces the 400 policy refusal %s verbatim', async (code, copy) => {
    stubFetch([400, { ok: false, error: copy, code }])
    renderClaim()
    await claimAndSettle()

    expect(takenCard()).not.toBeInTheDocument()
    expect(screen.getByText(copy)).toBeInTheDocument()
  })

  // A conflict we can't identify is still most likely a race on THIS path, but we
  // say so in retryable copy rather than showing the dead-end card on a guess.
  it('falls back to conflict copy for a 409 with no code', async () => {
    stubFetch([409, { ok: false }])
    renderClaim()
    await claimAndSettle()

    expect(takenCard()).not.toBeInTheDocument()
    expect(
      screen.getByText(/no longer available. Please try another opening/i),
    ).toBeInTheDocument()
  })

  it('pushes the booking on success', async () => {
    stubFetch(
      [200, HOLD_OK],
      [200, { ok: true, booking: { id: 'bkg_1' } }],
    )
    renderClaim()
    await claimAndSettle()

    expect(takenCard()).not.toBeInTheDocument()
    expect(push).toHaveBeenCalledWith('/booking/bkg_1')
  })
})
