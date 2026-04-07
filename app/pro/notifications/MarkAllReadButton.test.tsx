import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MarkAllReadButton from '@/app/pro/notifications/MarkAllReadButton'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh,
  }),
}))

describe('MarkAllReadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
      }),
    )
  })

  it('renders enabled when unreadCount is greater than zero', () => {
    render(<MarkAllReadButton unreadCount={3} />)

    const button = screen.getByRole('button', {
      name: 'Mark all 3 unread notifications as read',
    })

    expect(button).toBeInTheDocument()
    expect(button).toBeEnabled()
    expect(button).toHaveTextContent('Mark all read')
  })

  it('renders disabled when unreadCount is zero', () => {
    render(<MarkAllReadButton unreadCount={0} />)

    const button = screen.getByRole('button', {
      name: 'No unread notifications',
    })

    expect(button).toBeInTheDocument()
    expect(button).toBeDisabled()
  })

  it('posts to the bulk mark-read route and refreshes on success', async () => {
    render(<MarkAllReadButton unreadCount={5} />)

    const button = screen.getByRole('button', {
      name: 'Mark all 5 unread notifications as read',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/pro/notifications/mark-read',
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
      expect(refresh).toHaveBeenCalled()
    })
  })

  it('shows loading state while request is in flight', async () => {
    let resolveFetch: ((value: { ok: boolean }) => void) | undefined

    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )

    render(<MarkAllReadButton unreadCount={2} />)

    const button = screen.getByRole('button', {
      name: 'Mark all 2 unread notifications as read',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Marking…')
    })

    expect(screen.getByRole('button')).toBeDisabled()

    if (!resolveFetch) {
    throw new Error('fetch resolver was not set')
    }

    resolveFetch({ ok: true })

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled()
    })
  })

  it('does not refresh when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
      }),
    )

    render(<MarkAllReadButton unreadCount={4} />)

    const button = screen.getByRole('button', {
      name: 'Mark all 4 unread notifications as read',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    expect(refresh).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Mark all read')
      expect(screen.getByRole('button')).toBeEnabled()
    })
  })

  it('does not refresh when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    )

    render(<MarkAllReadButton unreadCount={4} />)

    const button = screen.getByRole('button', {
      name: 'Mark all 4 unread notifications as read',
    })

    fireEvent.click(button)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    expect(refresh).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Mark all read')
      expect(screen.getByRole('button')).toBeEnabled()
    })
  })

  it('does nothing when clicked while disabled', async () => {
    render(<MarkAllReadButton unreadCount={0} />)

    const button = screen.getByRole('button', {
      name: 'No unread notifications',
    })

    fireEvent.click(button)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})