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

import ForgotPasswordClient from './ForgotPasswordClient'

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

describe('app/(auth)/_components/forgot/ForgotPasswordClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('submits the email and shows the generic check-your-inbox state', async () => {
    const user = userEvent.setup()

    fetchMock.mockResolvedValueOnce(makeResponse({ ok: true }))

    render(<ForgotPasswordClient />)

    await user.type(
      screen.getByLabelText(/email/i),
      'USER@Example.com',
    )

    await user.click(
      screen.getByRole('button', { name: /send reset link/i }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/request',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'USER@Example.com' }),
      }),
    )

    expect(
      await screen.findByText('Check your inbox'),
    ).toBeInTheDocument()

    expect(
      screen.getByText(/If an account exists for/i),
    ).toBeInTheDocument()

    expect(screen.getByText('USER@Example.com')).toBeInTheDocument()
  })

  it('shows the sending state while the request is in flight', async () => {
    const user = userEvent.setup()
    const pending = deferredResponse()

    fetchMock.mockReturnValueOnce(pending.promise)

    render(<ForgotPasswordClient />)

    await user.type(
      screen.getByLabelText(/email/i),
      'user@example.com',
    )

    await user.click(
      screen.getByRole('button', { name: /send reset link/i }),
    )

    expect(
      screen.getByRole('button', { name: /sending/i }),
    ).toBeDisabled()

    pending.resolve(makeResponse({ ok: true }))

    expect(
      await screen.findByText('Check your inbox'),
    ).toBeInTheDocument()
  })

  it('keeps the form visible and shows an error if the request fails', async () => {
  const user = userEvent.setup()

  fetchMock.mockRejectedValueOnce(new Error('network down'))

  render(<ForgotPasswordClient />)

  await user.type(
    screen.getByLabelText(/email/i),
    'user@example.com',
  )

  await user.click(
    screen.getByRole('button', { name: /send reset link/i }),
  )

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  expect(
    await screen.findByText(
      'Could not send reset email right now. Please try again.',
    ),
  ).toBeInTheDocument()

  expect(
    screen.getByRole('button', { name: /send reset link/i }),
  ).toBeInTheDocument()

  expect(
    screen.queryByText('Check your inbox'),
  ).not.toBeInTheDocument()
})
})