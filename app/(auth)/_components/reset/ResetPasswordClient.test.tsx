import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../AuthShell', () => ({
  default: ({
    children,
    title,
    subtitle,
  }: {
    children: React.ReactNode
    title: string
    subtitle: string
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </div>
  ),
}))

import ResetPasswordClient from './ResetPasswordClient'

function makeResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferredResponse() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('app/(auth)/_components/reset/ResetPasswordClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('submits the token and new password, then shows the success state', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValueOnce(makeResponse({ ok: true }))

    render(<ResetPasswordClient token="reset_token_123" />)

    await user.type(
      screen.getByPlaceholderText('At least 8 characters'),
      'NewPassword123!',
    )

    await user.click(
      screen.getByRole('button', { name: /update password/i }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'reset_token_123',
          password: 'NewPassword123!',
        }),
      }),
    )

    expect(
      await screen.findByText('Password updated'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('You can now sign in with your new password.'),
    ).toBeInTheDocument()
  })

it('toggles password visibility', async () => {
  const user = userEvent.setup()

  render(<ResetPasswordClient token="reset_token_123" />)

  const input = screen.getByPlaceholderText(
    'At least 8 characters',
  ) as HTMLInputElement

  expect(input.type).toBe('password')

  await user.click(screen.getByText('Show'))
  expect(input.type).toBe('text')

  await user.click(screen.getByText('Hide'))
  expect(input.type).toBe('password')
})

  it('shows the loading state while the request is in flight', async () => {
    const user = userEvent.setup()
    const pending = deferredResponse()

    fetchMock.mockReturnValueOnce(pending.promise)

    render(<ResetPasswordClient token="reset_token_123" />)

    await user.type(
      screen.getByPlaceholderText('At least 8 characters'),
      'NewPassword123!',
    )

    await user.click(
      screen.getByRole('button', { name: /update password/i }),
    )

    expect(
      screen.getByRole('button', { name: /updating/i }),
    ).toBeDisabled()

    pending.resolve(makeResponse({ ok: true }))

    expect(
      await screen.findByText('Password updated'),
    ).toBeInTheDocument()
  })

  it('shows the server error and keeps the form visible when reset fails', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValueOnce(
      makeResponse(
        {
          ok: false,
          error: 'This reset link is invalid or has expired.',
        },
        400,
      ),
    )

    render(<ResetPasswordClient token="reset_token_123" />)

    await user.type(
      screen.getByPlaceholderText('At least 8 characters'),
      'NewPassword123!',
    )

    await user.click(
      screen.getByRole('button', { name: /update password/i }),
    )

    expect(
      await screen.findByText('This reset link is invalid or has expired.'),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /update password/i }),
    ).toBeInTheDocument()

    expect(
      screen.queryByText('Password updated'),
    ).not.toBeInTheDocument()
  })
})