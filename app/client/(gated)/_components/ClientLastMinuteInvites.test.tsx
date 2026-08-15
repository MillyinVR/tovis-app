// app/client/(gated)/_components/ClientLastMinuteInvites.test.tsx
//
// Both doors out of this card were missing, and both pages behind them were
// built and working:
//
//   /client/openings — had NO inbound link anywhere in the app. The page, its
//     feed component and GET /api/v1/client/openings all shipped; nothing ever
//     pointed at them, so the only way in was typing the URL.
//   /client/offers   — had no IN-APP link. Its only route was the href on a push
//     notification, so a client who dismissed that notification could not get
//     back to their own priority offers.
//
// iOS has carried both links on this same card for a while (HomeView's
// last-minute card → OpeningsFeedView / PriorityOffersView); web just never got
// them. This suite pins them, and pins them as UNCONDITIONAL — the interesting
// case is the empty one, because gating a door on having data is exactly how
// /client/bookings got stranded before CLIENT_TABS (see app/config/clientNav.ts).

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The row internals (remote images, pro profile links, tier pricing) are not
// what this suite is about — it is about the two links that frame them.
vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: () => <div />,
}))
vi.mock('@/app/_components/ProProfileLink', () => ({
  default: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}))

import ClientLastMinuteInvites from './ClientLastMinuteInvites'
import { lastMinuteInviteFixture } from './clientHomeInvite.fixtures'

describe('ClientLastMinuteInvites', () => {
  // The empty case is the load-bearing one: no invites is precisely when a
  // client most needs the full openings feed, and precisely when a
  // data-gated link would vanish.
  it('links to the openings feed and priority offers with NO invites', () => {
    render(<ClientLastMinuteInvites invites={[]} />)

    expect(screen.getByRole('link', { name: /See all/i })).toHaveAttribute(
      'href',
      '/client/openings',
    )
    expect(
      screen.getByRole('link', { name: /Your priority offers/i }),
    ).toHaveAttribute('href', '/client/offers')
  })
})

// ---------------------------------------------------------------------------
// "today" / "tomorrow" is a claim about the OPENING's day.
//
// It used to be computed with the runtime's local calendar
// (`new Date(y, m, d)`), which on Vercel is UTC. So a 9pm New York appointment —
// 01:00 UTC the NEXT day — was labelled "tomorrow" while the time beside it,
// which HAS always been rendered in the opening's zone, said 9:00 PM. The card
// contradicted itself, and only for evening slots.
// ---------------------------------------------------------------------------
describe('ClientLastMinuteInvites — the day label is counted in the opening’s zone', () => {
  const NEW_YORK = 'America/New_York'

  afterEach(() => {
    vi.useRealTimers()
  })

  // 2026-08-12 18:00 UTC = 2pm in New York. "Today" there.
  function freezeAtNewYorkAfternoon() {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T18:00:00.000Z'))
  }

  it('says "today" for an evening slot that is already tomorrow in UTC', () => {
    freezeAtNewYorkAfternoon()

    // 2026-08-13 01:00 UTC = 2026-08-12 9:00 PM in New York — still TODAY for
    // the client, but a UTC calendar reads it as the 13th.
    render(
      <ClientLastMinuteInvites
        invites={[
          lastMinuteInviteFixture({
            startAt: new Date('2026-08-13T01:00:00.000Z'),
            timeZone: NEW_YORK,
          }),
        ]}
      />,
    )

    expect(screen.getByText(/9:00\s*PM\s*today/i)).toBeInTheDocument()
    expect(screen.queryByText(/tomorrow/i)).not.toBeInTheDocument()
  })

  it('says "tomorrow" for a slot that really is the next day in the opening’s zone', () => {
    freezeAtNewYorkAfternoon()

    // 2026-08-13 18:00 UTC = 2026-08-13 2:00 PM in New York — genuinely tomorrow.
    render(
      <ClientLastMinuteInvites
        invites={[
          lastMinuteInviteFixture({
            startAt: new Date('2026-08-13T18:00:00.000Z'),
            timeZone: NEW_YORK,
          }),
        ]}
      />,
    )

    expect(screen.getByText(/2:00\s*PM\s*tomorrow/i)).toBeInTheDocument()
  })

  it('falls back to a weekday label further out', () => {
    freezeAtNewYorkAfternoon()

    render(
      <ClientLastMinuteInvites
        invites={[
          lastMinuteInviteFixture({
            startAt: new Date('2026-08-16T18:00:00.000Z'),
            timeZone: NEW_YORK,
          }),
        ]}
      />,
    )

    expect(screen.getByText(/Sun, Aug 16/i)).toBeInTheDocument()
  })
})
