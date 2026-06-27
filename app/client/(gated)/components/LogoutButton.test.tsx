// app/client/components/LogoutButton.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHardNavigate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hardNavigate', () => ({
  hardNavigate: mockHardNavigate,
}))

import LogoutButton from './LogoutButton'

describe('app/client/components/LogoutButton', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('shows a clear sign out label', () => {
    render(<LogoutButton />)

    expect(
      screen.getByRole('button', { name: /sign out/i }),
    ).toBeInTheDocument()
  })

  it('signs out and hard-navigates to login', async () => {
    const user = userEvent.setup()

    render(<LogoutButton />)

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      })
    })

    await waitFor(() => {
      expect(mockHardNavigate).toHaveBeenCalledWith('/login')
    })
  })
})
