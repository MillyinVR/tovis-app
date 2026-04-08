// app/pro/notifications/NotificationCard.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationEventKey } from '@prisma/client'
import NotificationCard from '@/app/pro/notifications/NotificationCard'

const push = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
    refresh,
  }),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
    className,
    prefetch: _prefetch,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: React.ReactNode
    prefetch?: boolean
  }) => (
    <a
      role="link"
      data-href={href}
      onClick={onClick}
      className={className}
      {...rest}
    >
      {children}
    </a>
  ),
}))

function renderCard(
  overrides?: Partial<React.ComponentProps<typeof NotificationCard>>,
) {
  return render(
    <NotificationCard
      id="notif_123"
      eventKey={NotificationEventKey.BOOKING_REQUEST_CREATED}
      title="New booking request"
      body="Someone requested a booking."
      href="/pro/bookings/booking_123"
      createdAtLabel="10:45 AM"
      unread={true}
      {...overrides}
    />,
  )
}

describe('NotificationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
      }),
    )
  })

  it('renders notification content', () => {
    renderCard()

    expect(screen.getByText('Booking request')).toBeInTheDocument()
    expect(screen.getByText('New booking request')).toBeInTheDocument()
    expect(screen.getByText('Someone requested a booking.')).toBeInTheDocument()
    expect(screen.getByText('10:45 AM')).toBeInTheDocument()
    expect(screen.getByText('Unread')).toBeInTheDocument()
  })

  it('marks the notification read on normal click and navigates', async () => {
    renderCard()

    const link = screen.getByRole('link', {
      name: 'Booking request: New booking request',
    })

    fireEvent.click(link)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pro/notifications/notif_123/mark-read',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          cache: 'no-store',
        },
      )
    })

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/pro/bookings/booking_123')
      expect(refresh).toHaveBeenCalled()
    })

    expect(screen.queryByText('Unread')).not.toBeInTheDocument()
  })

  it('rolls unread state back if mark-read request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
      }),
    )

    renderCard()

    const link = screen.getByRole('link', {
      name: 'Booking request: New booking request',
    })

    fireEvent.click(link)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(screen.getByText('Unread')).toBeInTheDocument()
    })

    expect(push).toHaveBeenCalledWith('/pro/bookings/booking_123')
    expect(refresh).toHaveBeenCalled()
  })

  it('rolls unread state back if mark-read request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    )

    renderCard()

    const link = screen.getByRole('link', {
      name: 'Booking request: New booking request',
    })

    fireEvent.click(link)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(screen.getByText('Unread')).toBeInTheDocument()
    })

    expect(push).toHaveBeenCalledWith('/pro/bookings/booking_123')
    expect(refresh).toHaveBeenCalled()
  })

  it('does not mark read or hijack navigation on cmd/ctrl click', async () => {
    renderCard()

    const link = screen.getByRole('link', {
      name: 'Booking request: New booking request',
    })

    fireEvent.click(link, { ctrlKey: true })

    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalled()
    })

    expect(push).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByText('Unread')).toBeInTheDocument()
  })

  it('does not call mark-read when notification is already read', async () => {
    renderCard({ unread: false })

    const link = screen.getByRole('link', {
      name: 'Booking request: New booking request',
    })

    fireEvent.click(link)

    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalled()
    })

    expect(push).toHaveBeenCalledWith('/pro/bookings/booking_123')
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByText('Unread')).not.toBeInTheDocument()
  })

  it('falls back to /pro/notifications for unsafe hrefs', async () => {
    renderCard({ href: 'https://evil.example.com' })

    const link = screen.getByRole('link', {
      name: 'Booking request: New booking request',
    })

    fireEvent.click(link)

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/pro/notifications')
      expect(refresh).toHaveBeenCalled()
    })
  })
})