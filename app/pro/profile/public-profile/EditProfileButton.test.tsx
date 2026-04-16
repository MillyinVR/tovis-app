// app/pro/profile/public-profile/EditProfileButton.test.tsx 

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}))

vi.mock('@/lib/supabaseBrowser', () => ({
  supabaseBrowser: {
    storage: {
      from: () => ({
        uploadToSignedUrl: vi.fn(),
      }),
    },
  },
}))

vi.mock('@/lib/guards', () => ({
  asTrimmedString: (value: unknown) =>
    typeof value === 'string' ? value.trim() : null,
}))

vi.mock('@/lib/http', () => ({
  safeJson: async (res: Response) => res.json().catch(() => null),
  readErrorMessage: (data: unknown) =>
    data &&
    typeof data === 'object' &&
    'error' in data &&
    typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error
      : null,
  errorMessageFromUnknown: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error',
}))

vi.mock('@/lib/url', () => ({
  withCacheBuster: (url: string) => url,
}))

import EditProfileButton from './EditProfileButton'

function makeInitial() {
  return {
    businessName: 'TOVIS Studio',
    bio: 'Trusted beauty pro.',
    location: 'San Diego, CA',
    avatarUrl: null,
    professionType: 'BARBER',
    handle: 'tovisstudio',
    isPremium: true,
  }
}

describe('app/pro/profile/public-profile/EditProfileButton', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  it('locks the handle field and shows pending-review copy when canEditHandle is false', async () => {
    const user = userEvent.setup()

    render(
      <EditProfileButton
        canEditHandle={false}
        initial={makeInitial()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))

    const handleInput = screen.getByPlaceholderText('e.g. tori')
    expect(handleInput).toBeDisabled()

    expect(
      screen.getByText(
        'Your public profile link unlocks after approval. You can finish the rest of your profile now.',
      ),
    ).toBeInTheDocument()

    expect(screen.queryByText(/vanity link:/i)).not.toBeInTheDocument()
  })

  it('keeps the handle field editable and shows the vanity preview when canEditHandle is true', async () => {
    const user = userEvent.setup()

    render(
      <EditProfileButton
        canEditHandle
        initial={makeInitial()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))

    const handleInput = screen.getByPlaceholderText('e.g. tori')
    expect(handleInput).toBeEnabled()

    expect(screen.getByText(/vanity link:/i)).toBeInTheDocument()
    expect(screen.getByText('tovisstudio.tovis.me')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('omits handle from the PATCH payload when canEditHandle is false', async () => {
    const user = userEvent.setup()

    render(
      <EditProfileButton
        canEditHandle={false}
        initial={makeInitial()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))

    const businessNameInput = screen.getByPlaceholderText('e.g. Lumara Beauty')
    await user.clear(businessNameInput)
    await user.type(businessNameInput, 'Updated Studio')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pro/profile',
        expect.objectContaining({
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }),
      )
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(body.businessName).toBe('Updated Studio')
    expect(body.professionType).toBe('BARBER')
    expect(body.location).toBe('San Diego, CA')
    expect(body.bio).toBe('Trusted beauty pro.')
    expect(body.avatarUrl).toBe('')
    expect(body).not.toHaveProperty('handle')

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('includes handle in the PATCH payload when canEditHandle is true', async () => {
    const user = userEvent.setup()

    render(
      <EditProfileButton
        canEditHandle
        initial={makeInitial()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))

    const handleInput = screen.getByPlaceholderText('e.g. tori')
    await user.clear(handleInput)
    await user.type(handleInput, 'New-Handle')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pro/profile',
        expect.objectContaining({
          method: 'PATCH',
        }),
      )
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>

    expect(body.handle).toBe('New-Handle')
    expect(body.businessName).toBe('TOVIS Studio')

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })
})