import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockReplace = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockSearchParamsGet = vi.hoisted(() => vi.fn())

const mockRouter = vi.hoisted(() => ({
  replace: mockReplace,
  refresh: mockRefresh,
}))

const mockSearchParams = vi.hoisted(() => ({
  get: mockSearchParamsGet,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
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

vi.mock('../_components/AuthShell', () => ({
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

vi.mock('@/lib/http', () => ({
  safeJsonRecord: async (res: Response) => {
    const data = await res.json().catch(() => null)
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null
  },
  readErrorMessage: (data: Record<string, unknown> | null) =>
    typeof data?.error === 'string' ? data.error : null,
  readStringField: (data: Record<string, unknown> | null, key: string) =>
    typeof data?.[key] === 'string' ? (data[key] as string) : null,
}))

import VerifyPhonePage from './page'

function makeResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeStatusBody(args?: {
  sessionKind?: 'ACTIVE' | 'VERIFICATION'
  isPhoneVerified?: boolean
  isEmailVerified?: boolean
  isFullyVerified?: boolean
  nextUrl?: string | null
  role?: 'CLIENT' | 'PRO' | 'ADMIN'
  email?: string | null
}) {
  const isPhoneVerified = args?.isPhoneVerified ?? false
  const isEmailVerified = args?.isEmailVerified ?? false
  const isFullyVerified = args?.isFullyVerified ?? false

  return {
    ok: true,
    user: {
      id: 'user_1',
      email: args?.email ?? 'user@example.com',
      role: args?.role ?? 'CLIENT',
    },
    sessionKind: args?.sessionKind ?? 'VERIFICATION',
    isPhoneVerified,
    isEmailVerified,
    isFullyVerified,
    requiresPhoneVerification: !isPhoneVerified,
    requiresEmailVerification: !isEmailVerified,
    nextUrl: args?.nextUrl ?? '/looks',
  }
}

describe('app/(auth)/verify-phone/page', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    mockReplace.mockReset()
    mockRefresh.mockReset()
    mockSearchParamsGet.mockReset()
    fetchMock.mockReset()

    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'next') return null
      if (key === 'email') return null
      if (key === 'sms') return null
      if (key === 'intent') return null
      if (key === 'inviteToken') return null
      return null
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads partial verification state from server truth and shows the email retry banner', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'next') return '/looks?from=tap'
      if (key === 'email') return 'retry'
      if (key === 'sms') return null
      return null
    })

    fetchMock.mockResolvedValueOnce(
      makeResponse(
        makeStatusBody({
          isPhoneVerified: false,
          isEmailVerified: false,
          isFullyVerified: false,
          nextUrl: '/looks',
          role: 'CLIENT',
          email: 'client@example.com',
        }),
      ),
    )

    render(<VerifyPhonePage />)

    expect(
      await screen.findByText(
        'We could not send your verification email during signup. Use the resend button below to send it now.',
      ),
    ).toBeInTheDocument()

    expect(screen.getAllByText('Pending')).toHaveLength(2)
    expect(screen.getByText('Verification incomplete')).toBeInTheDocument()
    expect(
      screen.getByText('Verification email destination:'),
    ).toBeInTheDocument()
    expect(screen.getByText('client@example.com')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /resend verification email/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /resend code/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /verify phone/i }),
    ).toBeInTheDocument()

    expect(mockReplace).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads partial verification state from server truth and shows the sms retry banner', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'next') return '/looks?from=tap'
      if (key === 'email') return null
      if (key === 'sms') return 'retry'
      return null
    })

    fetchMock.mockResolvedValueOnce(
      makeResponse(
        makeStatusBody({
          isPhoneVerified: false,
          isEmailVerified: false,
          isFullyVerified: false,
          nextUrl: '/looks',
          role: 'CLIENT',
          email: 'client@example.com',
        }),
      ),
    )

    render(<VerifyPhonePage />)

    expect(
      await screen.findByText(
        'We could not send your phone verification code during signup. Use the resend button below to send it now.',
      ),
    ).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /resend code/i })).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves claim handoff on the back-to-sign-in link', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'next') return '/claim/tok_1'
      if (key === 'email') return 'retry'
      if (key === 'sms') return null
      if (key === 'intent') return 'CLAIM_INVITE'
      if (key === 'inviteToken') return 'tok_1'
      return null
    })

    fetchMock.mockResolvedValueOnce(
      makeResponse(
        makeStatusBody({
          isPhoneVerified: false,
          isEmailVerified: false,
          isFullyVerified: false,
          nextUrl: '/looks',
          role: 'CLIENT',
          email: 'client@example.com',
        }),
      ),
    )

    render(<VerifyPhonePage />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const backLink = screen.getByRole('link', { name: /back to sign in/i })
    expect(backLink).toHaveAttribute(
      'href',
      '/login?from=%2Fclaim%2Ftok_1&next=%2Fclaim%2Ftok_1&email=client%40example.com&intent=CLAIM_INVITE&inviteToken=tok_1',
    )
  })

  it('verifies phone, refreshes server truth, and keeps the user in verification flow when email is still pending', async () => {
    const user = userEvent.setup()

    fetchMock
      .mockResolvedValueOnce(
        makeResponse(
          makeStatusBody({
            isPhoneVerified: false,
            isEmailVerified: false,
            isFullyVerified: false,
            nextUrl: '/looks',
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          isPhoneVerified: true,
          isEmailVerified: false,
          isFullyVerified: false,
          requiresEmailVerification: true,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(
          makeStatusBody({
            isPhoneVerified: true,
            isEmailVerified: false,
            isFullyVerified: false,
            nextUrl: '/looks',
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )

    render(<VerifyPhonePage />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const codeInput = screen.getByPlaceholderText('123456')
    await user.type(codeInput, '123456')
    await user.click(screen.getByRole('button', { name: /verify phone/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/phone/verify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: '123456' }),
      }),
    )

    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()

    expect(
      await screen.findByText(
        'Phone verified. Email verification is still required before full app access.',
      ),
    ).toBeInTheDocument()

    expect(screen.getByText('Your phone is verified.')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('redirects immediately when the loaded verification status is already fully verified', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'next') return '/client/bookings'
      if (key === 'email') return null
      if (key === 'sms') return null
      return null
    })

    fetchMock.mockResolvedValueOnce(
      makeResponse(
        makeStatusBody({
          sessionKind: 'ACTIVE',
          isPhoneVerified: true,
          isEmailVerified: true,
          isFullyVerified: true,
          nextUrl: '/looks',
          role: 'CLIENT',
          email: 'client@example.com',
        }),
      ),
    )

    render(<VerifyPhonePage />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/client/bookings')
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resends verification email and shows success feedback', async () => {
    const user = userEvent.setup()

    fetchMock
      .mockResolvedValueOnce(
        makeResponse(
          makeStatusBody({
            isPhoneVerified: true,
            isEmailVerified: false,
            isFullyVerified: false,
            nextUrl: '/looks',
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          sent: true,
          isPhoneVerified: true,
          isEmailVerified: false,
          isFullyVerified: false,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(
          makeStatusBody({
            isPhoneVerified: true,
            isEmailVerified: false,
            isFullyVerified: false,
            nextUrl: '/looks',
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )

    render(<VerifyPhonePage />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    await user.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/email/send',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          next: '/looks',
          intent: null,
          inviteToken: null,
        }),
      }),
    )

    expect(
      await screen.findByText('Verification email sent. Check your inbox.'),
    ).toBeInTheDocument()
  })

  it('resends phone verification code and shows success feedback', async () => {
    const user = userEvent.setup()

    fetchMock
      .mockResolvedValueOnce(
        makeResponse(
          makeStatusBody({
            isPhoneVerified: false,
            isEmailVerified: false,
            isFullyVerified: false,
            nextUrl: '/looks',
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          sent: true,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(
          makeStatusBody({
            isPhoneVerified: false,
            isEmailVerified: false,
            isFullyVerified: false,
            nextUrl: '/looks',
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )

    render(<VerifyPhonePage />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: /resend code/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/phone/send',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      }),
    )

    expect(
      await screen.findByText('New phone verification code sent.'),
    ).toBeInTheDocument()
  })
})
