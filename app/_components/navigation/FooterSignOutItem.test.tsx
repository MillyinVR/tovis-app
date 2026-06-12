// app/_components/navigation/FooterSignOutItem.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHardNavigate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hardNavigate', () => ({
  hardNavigate: mockHardNavigate,
}))

import FooterSignOutItem from './FooterSignOutItem'

describe('app/_components/navigation/FooterSignOutItem', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it('signs out and hard-navigates to login', async () => {
    const user = userEvent.setup()

    render(<FooterSignOutItem />)

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      })
    })

    await waitFor(() => {
      expect(mockHardNavigate).toHaveBeenCalledWith('/login')
    })
  })

  it('still navigates to login when the logout request fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    render(<FooterSignOutItem />)

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => {
      expect(mockHardNavigate).toHaveBeenCalledWith('/login')
    })
  })
})
