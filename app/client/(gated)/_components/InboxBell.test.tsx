import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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

vi.mock('@/app/_components/_hooks/useUnreadBadge', () => ({
  useUnreadBadge: mocks.useUnreadBadge,
}))

import InboxBell from './InboxBell'

afterEach(() => {
  vi.clearAllMocks()
})

describe('InboxBell', () => {
  it('links to the shared /messages inbox (not the dead /client/inbox)', () => {
    mocks.useUnreadBadge.mockReturnValue(null)

    render(<InboxBell />)

    const link = screen.getByRole('link', { name: 'Inbox' })
    expect(link).toHaveAttribute('href', '/messages')
  })

  it('does not render the unread dot when there are no unread threads', () => {
    mocks.useUnreadBadge.mockReturnValue(null)

    const { container } = render(<InboxBell />)

    expect(container.querySelector('.bg-gold')).toBeNull()
  })

  it('renders the unread dot from the shared unread-message source', () => {
    mocks.useUnreadBadge.mockReturnValue('3')

    const { container } = render(<InboxBell />)

    expect(container.querySelector('.bg-gold')).not.toBeNull()
  })
})
