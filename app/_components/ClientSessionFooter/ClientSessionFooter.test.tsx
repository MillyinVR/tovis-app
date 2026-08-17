// app/_components/ClientSessionFooter/ClientSessionFooter.test.tsx
//
// W9 left the footer's Inbox badge as the client's ONLY unread-messages
// indicator: the client home header used to carry a second bell reading the very
// same `useUnreadBadge` hook and endpoint, so it was a duplicate signal rather
// than an extra one, and it was removed.
//
// That makes this suite the thing standing between "one honest indicator" and
// "no indicator at all". It pins two facts the removal depends on: the hook
// still has a live consumer here (it is NOT orphaned by the bell going away),
// and the tab it feeds is still the one flagged `hasBadge` in CLIENT_TABS.

import { screen } from '@testing-library/react'
import { renderWithBrand as render } from '@/test/renderWithBrand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useUnreadBadge: vi.fn(),
}))

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

vi.mock('next/navigation', () => ({
  usePathname: mocks.usePathname,
}))

vi.mock('@/app/_components/_hooks/useUnreadBadge', () => ({
  useUnreadBadge: mocks.useUnreadBadge,
}))

import ClientSessionFooter from './ClientSessionFooter'
import { CLIENT_TABS } from '@/app/config/clientNav'

describe('ClientSessionFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePathname.mockReturnValue('/client')
    mocks.useUnreadBadge.mockReturnValue(null)
  })

  // The load-bearing one. If the header bell's removal had also taken the
  // footer's use of the hook, a client would have no unread signal anywhere.
  it('still drives its Inbox badge from useUnreadBadge', () => {
    mocks.useUnreadBadge.mockReturnValue('4')

    render(<ClientSessionFooter messagesBadge="4" />)

    expect(mocks.useUnreadBadge).toHaveBeenCalledWith({ initialBadge: '4' })
    expect(screen.getByRole('link', { name: /inbox/i })).toHaveAttribute(
      'href',
      '/messages',
    )
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('renders no badge when there is nothing unread', () => {
    render(<ClientSessionFooter />)

    expect(mocks.useUnreadBadge).toHaveBeenCalledWith({ initialBadge: null })
    expect(screen.queryByText('4')).not.toBeInTheDocument()
  })

  // Bookings deliberately left the footer for the home area. This asserts the
  // move rather than just the absence: the bar carries no bookings tab, AND the
  // unconditional route it used to be still exists on Home — pinned in
  // UpcomingAppointmentCard.test.tsx, which is what must go red if the home link
  // is ever made conditional again. /client/bookings is the only surface listing
  // PENDING bookings, so "removed from the footer" must never become "removed".
  it('carries no bookings tab — that route lives on Home now', () => {
    render(<ClientSessionFooter />)

    expect(
      screen.queryByRole('link', { name: /bookings/i }),
    ).not.toBeInTheDocument()
    expect(CLIENT_TABS.some((tab) => tab.href === '/client/bookings')).toBe(
      false,
    )
  })

  // The bar renders as two groups flanking the raised mark, so a slice-off-by-one
  // in that split would silently swallow a tab rather than fail loudly.
  it('renders every configured tab exactly once across the split', () => {
    render(<ClientSessionFooter />)

    for (const tab of CLIENT_TABS) {
      expect(
        screen.getAllByRole('link', { name: new RegExp(`^${tab.label}$`, 'i') }),
      ).toHaveLength(1)
    }

    expect(screen.getAllByRole('link')).toHaveLength(CLIENT_TABS.length)
  })

  // Exactly one tab may carry the unread badge — that singularity is the whole
  // point of removing the header bell, and it lives in config where a second
  // `hasBadge: true` would be a one-word regression.
  it('has exactly one badge-bearing tab, and it is Inbox', () => {
    const badged = CLIENT_TABS.filter((tab) => tab.hasBadge)

    expect(badged).toHaveLength(1)
    expect(badged[0]?.id).toBe('inbox')
    expect(badged[0]?.href).toBe('/messages')
  })
})
