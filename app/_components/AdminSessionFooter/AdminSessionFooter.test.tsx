// app/_components/AdminSessionFooter/AdminSessionFooter.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUsePathname = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  usePathname: mockUsePathname,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/hardNavigate', () => ({
  hardNavigate: vi.fn(),
}))

import AdminSessionFooter from './AdminSessionFooter'

describe('app/_components/AdminSessionFooter/AdminSessionFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePathname.mockReturnValue('/admin')
  })

  it('renders the admin nav items', () => {
    render(<AdminSessionFooter />)

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(screen.getByRole('link', { name: /approve/i })).toHaveAttribute(
      'href',
      '/admin/professionals',
    )
    expect(screen.getByRole('link', { name: /services/i })).toHaveAttribute(
      'href',
      '/admin/services',
    )
    expect(screen.getByRole('link', { name: /nfc/i })).toHaveAttribute(
      'href',
      '/admin/nfc',
    )
    expect(screen.getByRole('link', { name: /support/i })).toHaveAttribute(
      'href',
      '/admin/support',
    )
    expect(screen.getByRole('link', { name: /alerts/i })).toHaveAttribute(
      'href',
      '/admin/notifications',
    )
  })

  it('shows the unread admin-notification badge when provided', () => {
    render(<AdminSessionFooter notificationsBadge="3" />)

    const alerts = screen.getByRole('link', { name: /alerts/i })
    expect(alerts).toHaveTextContent('3')
  })

  it('omits the badge when there are no unread alerts', () => {
    render(<AdminSessionFooter notificationsBadge={null} />)

    const alerts = screen.getByRole('link', { name: /alerts/i })
    expect(alerts).not.toHaveTextContent('3')
  })

  it('exposes sign out inside the Switch account sheet', () => {
    render(<AdminSessionFooter />)

    // Sign out no longer lives in the footer bar; it's inside the sheet.
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /switch/i }))

    const dialog = screen.getByRole('dialog', { name: /switch account/i })
    expect(dialog).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument()
  })
})
