import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

import PhoneLoginForm from './PhoneLoginForm'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** A fully-verified CLIENT verify response → resolvePostAuthNavigation → /looks. */
function verifiedClientResponse(nextUrl: string | null = null): Response {
  return jsonResponse({
    user: { id: 'u1', email: 'a@b.com', role: 'CLIENT' },
    token: 'tok',
    nextUrl,
    isPhoneVerified: true,
    isEmailVerified: true,
    isFullyVerified: true,
  })
}

const assignMock = vi.fn()

function renderForm(props: Partial<React.ComponentProps<typeof PhoneLoginForm>> = {}) {
  const onUsePassword = props.onUsePassword ?? vi.fn()
  render(
    <PhoneLoginForm
      nextSafe={props.nextSafe ?? null}
      fromSafe={props.fromSafe ?? null}
      initialPhone={props.initialPhone}
      onUsePassword={onUsePassword}
    />,
  )
  return { onUsePassword }
}

function typePhone(value: string) {
  fireEvent.change(screen.getByPlaceholderText('+1 555 123 4567'), {
    target: { value },
  })
}

function clickSendCode() {
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
}

describe('PhoneLoginForm', () => {
  beforeEach(() => {
    assignMock.mockReset()
    // jsdom's location.assign is non-configurable, so swap the whole object.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignMock, href: 'http://localhost/' },
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('sends a code, advances to the code step, then verifies and navigates', async () => {
    const fetchMock = setFetchSequence([
      jsonResponse({ message: 'sent' }),
      verifiedClientResponse(),
    ])

    renderForm()

    typePhone('+16195550123')
    clickSendCode()

    // Advances to the code entry step.
    await waitFor(() => {
      expect(screen.getByPlaceholderText('123456')).toBeInTheDocument()
    })

    // /send posted the phone.
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/auth/phone-login/send',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      phone: '+16195550123',
    })

    fireEvent.change(screen.getByPlaceholderText('123456'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith('/looks')
    })

    // /verify posted phone + code.
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/auth/phone-login/verify',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      phone: '+16195550123',
      code: '123456',
    })
  })

  it('honors the sanitized next target on a successful verify', async () => {
    setFetchSequence([
      jsonResponse({ message: 'sent' }),
      verifiedClientResponse(),
    ])

    renderForm({ nextSafe: '/looks/saved' })

    typePhone('+16195550123')
    clickSendCode()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('123456')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('123456'), {
      target: { value: '654321' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith('/looks/saved')
    })
  })

  it('blocks a short code client-side and never calls verify', async () => {
    const fetchMock = setFetchSequence([jsonResponse({ message: 'sent' })])

    renderForm()

    typePhone('+16195550123')
    clickSendCode()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('123456')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('123456'), {
      target: { value: '123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter the 6-digit code.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the /send call
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('surfaces a rejected code and does not navigate', async () => {
    setFetchSequence([
      jsonResponse({ message: 'sent' }),
      jsonResponse({ error: 'Incorrect or expired code.' }, 400),
    ])

    renderForm()

    typePhone('+16195550123')
    clickSendCode()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('123456')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('123456'), {
      target: { value: '000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByText('Incorrect or expired code.'),
    ).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('disables resend during the cooldown after sending', async () => {
    setFetchSequence([jsonResponse({ message: 'sent' })])

    renderForm()

    typePhone('+16195550123')
    clickSendCode()

    const resend = await screen.findByRole('button', { name: /Resend/ })
    expect(resend).toBeDisabled()
    expect(resend).toHaveTextContent(/Resend in \d:\d\d/)
  })

  it('keeps the phone step when the send is throttled', async () => {
    const fetchMock = setFetchSequence([
      jsonResponse({ error: 'Too many requests.', retryAfterSeconds: 42 }, 429),
    ])

    renderForm()

    typePhone('+16195550123')
    clickSendCode()

    expect(
      await screen.findByText(/Wait 0:42 and try again\./),
    ).toBeInTheDocument()
    // Still on the phone step — no code input rendered.
    expect(screen.queryByPlaceholderText('123456')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('prefills the phone from initialPhone and calls onUsePassword from the toggle', () => {
    const { onUsePassword } = renderForm({ initialPhone: '+16195559999' })

    expect(
      (screen.getByPlaceholderText('+1 555 123 4567') as HTMLInputElement).value,
    ).toBe('+16195559999')

    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with a password instead' }),
    )
    expect(onUsePassword).toHaveBeenCalledTimes(1)
  })
})
