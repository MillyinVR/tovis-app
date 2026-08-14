// app/client/(gated)/_components/ClientHomeShell.test.tsx
//
// W9: the client home header used to carry TWO bells. The second one read
// `useUnreadBadge` — the exact hook and endpoint behind the footer Inbox tab's
// badge (CLIENT_TABS.hasBadge) — so it duplicated a signal the client already
// had, in a second place, with its own polling.
//
// Notifications keeps a bell because the footer has no tab for
// /client/notifications; unread MESSAGES do not, because the footer does.
//
// The removal is a deletion, and deletions rot back: this pins the header to
// exactly one bell and names which one, so re-adding an inbox bell here is a
// red test rather than a silent regression.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Every child is stubbed to its own marker: this suite is about what the HEADER
// contains, not about rendering the whole home page.
vi.mock('./ClientGreeting', () => ({ default: () => <span>Good evening</span> }))
vi.mock('./UpcomingAppointmentCard', () => ({ default: () => <div /> }))
vi.mock('./ClientActionCard', () => ({ default: () => <div /> }))
vi.mock('./ClientLastMinuteInvites', () => ({ default: () => <div /> }))
vi.mock('./ClientWaitlistStrip', () => ({ default: () => <div /> }))
vi.mock('./FavoriteProsRow', () => ({ default: () => <div /> }))
vi.mock('./FavoritedServicesRow', () => ({ default: () => <div /> }))
vi.mock('./InviteFriendCard', () => ({ default: () => <div /> }))
vi.mock('./ViralLooksBand', () => ({ default: () => <div /> }))

vi.mock('./NotificationsBell', () => ({
  default: () => (
    <a href="/client/notifications" aria-label="Notifications">
      bell
    </a>
  ),
}))

// The hook the removed bell used. Nothing on this screen may reach for it —
// that is what "the footer badge is the sole unread-messages indicator" means.
//
// `vi.hoisted` is load-bearing, not style: `vi.mock` is hoisted above the file's
// own statements, so a plain `const` spy referenced in the factory throws
// "Cannot access before initialization" the moment something actually imports
// the hook — i.e. exactly when this assertion is supposed to catch a regression,
// turning a clean red into a confusing suite-level crash.
const mocks = vi.hoisted(() => ({ useUnreadBadge: vi.fn(() => null) }))

vi.mock('@/app/_components/_hooks/useUnreadBadge', () => ({
  useUnreadBadge: mocks.useUnreadBadge,
}))

import ClientHomeShell from './ClientHomeShell'
import type { ClientHomeData } from '../_data/getClientHomeData'

function renderShell() {
  // A genuinely empty home — every field of ClientHomeData is nullable or a
  // list, so this is a real value of the type rather than a cast. The children
  // are stubbed anyway; what matters is that the header renders.
  const home: ClientHomeData = {
    displayName: 'Maya',
    upcoming: null,
    upcomingCount: 0,
    upcomingProRating: null,
    action: null,
    invites: [],
    waitlists: [],
    favoritePros: [],
    favoriteServices: [],
    viralLive: [],
    viralPending: [],
  }

  return render(
    <ClientHomeShell
      brandText="Tovis"
      displayName="Wanda"
      home={home}
      removeProFavoriteAction={async () => {}}
    />,
  )
}

describe('ClientHomeShell header', () => {
  it('renders exactly one bell, and it is the notifications one', () => {
    renderShell()

    expect(
      screen.getByRole('link', { name: 'Notifications' }),
    ).toHaveAttribute('href', '/client/notifications')

    // No second bell. An inbox bell linked to /messages is precisely what W9
    // removed, so its return is the regression this asserts against.
    expect(screen.queryByRole('link', { name: /inbox/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /messages/i })).toBeNull()
  })

  // The other half of the same claim: the hook is not orphaned, it simply has no
  // consumer HERE. Its live consumer is the footer
  // (see ClientSessionFooter.test.tsx).
  it('never reads the footer’s unread-messages hook', () => {
    renderShell()

    expect(mocks.useUnreadBadge).not.toHaveBeenCalled()
  })
})
