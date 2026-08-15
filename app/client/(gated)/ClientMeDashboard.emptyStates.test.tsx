// app/client/(gated)/ClientMeDashboard.emptyStates.test.tsx
//
// /client/me was the only client screen drawing its own empty card; its eight
// siblings (bookings, activity, offers, aftercare, referrals, boards, openings,
// notifications) all render `app/_components/boundaries/EmptyState`. Migrating it
// swapped a `{ body, actionHref, actionLabel }` shape for the canonical's
// `{ description, action }`, and a prop that silently stops arriving is exactly
// what such a swap loses.
//
// The boards CTA in particular is unreachable in the dev database — the only
// seeded client has five boards — so it is pinned here rather than measured in a
// browser.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('./components/LogoutButton', () => ({
  default: () => <button type="button">Log out</button>,
}))

vi.mock('@/app/_components/WorkspaceSwitcher', () => ({ default: () => null }))
vi.mock('./_components/FollowSuggestionsRail', () => ({ default: () => null }))

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({ alt }: { alt: string }) => <span data-alt={alt} />,
}))

import ClientMeDashboard from './ClientMeDashboard'

function renderDashboard(createBoardHref: string | null) {
  return render(
    <ClientMeDashboard
      displayName="Ada"
      handle="ada"
      counts={{ followers: 0, boards: 0, saved: 0, booked: 0 }}
      upcomingNotificationBooking={null}
      boards={[]}
      following={[]}
      history={[]}
      publicProfile={{ handle: 'ada', isPublic: true }}
      activityHref="/client/activity"
      workspaces={[]}
      createBoardHref={createBoardHref}
    />,
  )
}

describe('/client/me empty states', () => {
  it('renders the boards empty state with its CTA when a create href exists', () => {
    renderDashboard('/client/boards/new')

    expect(screen.getByText('No boards yet')).toBeTruthy()
    expect(
      screen.getByText('Save looks from the feed to start building boards.'),
    ).toBeTruthy()

    // The CTA is a LINK, not a button: the canonical renders a <button> when it
    // is handed an onClick and no href, and losing the href in the prop rename
    // would have swapped a navigation for a no-op.
    const cta = screen.getByRole('link', { name: 'Create board' })
    expect(cta).toHaveAttribute('href', '/client/boards/new')
  })

  it('omits the CTA when there is no create href, rather than rendering a dead one', () => {
    renderDashboard(null)

    expect(screen.getByText('No boards yet')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Create board' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create board' })).toBeNull()
  })

  it('keeps the description on the CTA-less empty states', () => {
    renderDashboard(null)

    // Each lives behind its own tab; the default is BOARDS, so asserting without
    // switching would pass on an empty document.
    // `body` → `description`: a renamed prop that silently stops arriving renders
    // a titled card with nothing under it, and no test would have noticed.
    fireEvent.click(screen.getByRole('button', { name: 'FOLLOWING' }))
    expect(screen.getByText('No follows yet')).toBeTruthy()
    expect(
      screen.getByText('When you follow a pro, they’ll show up here.'),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'HISTORY' }))
    expect(screen.getByText('No history yet')).toBeTruthy()
    expect(
      screen.getByText('Your upcoming and past bookings will appear here.'),
    ).toBeTruthy()
  })
})
