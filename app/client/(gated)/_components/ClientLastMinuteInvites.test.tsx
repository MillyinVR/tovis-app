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
import { describe, expect, it, vi } from 'vitest'

// The row internals (remote images, pro profile links, tier pricing) are not
// what this suite is about — it is about the two links that frame them.
vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: () => <div />,
}))
vi.mock('@/app/_components/ProProfileLink', () => ({
  default: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}))

import ClientLastMinuteInvites from './ClientLastMinuteInvites'

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
