import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUseSearchParams = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: mockUseSearchParams,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('../_components/AuthShell', () => ({
  default: ({
    title,
    subtitle,
    children,
  }: {
    title: string
    subtitle: string
    children: React.ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </div>
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(' '),
}))

vi.mock('@/lib/http', () => ({
  safeJsonRecord: async (res: Response) => {
    try {
      return (await res.json()) as Record<string, unknown>
    } catch {
      return null
    }
  },
  readErrorMessage: (data: Record<string, unknown> | null) =>
    typeof data?.error === 'string' ? data.error : null,
  readStringField: (data: Record<string, unknown> | null, key: string) =>
    typeof data?.[key] === 'string' ? data[key] : null,
}))

import VerifyEmailPage from './page'

function setSearchParams(params: Record<string, string | null | undefined>) {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      searchParams.set(key, value)
    }
  }

  mockUseSearchParams.mockReturnValue(searchParams)
}

function makeJsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

describe('app/(auth)/verify-email/page', () => {
  beforeEach(() => {
    mockUseSearchParams.mockReset()
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('does not auto-consume the token on initial render', () => {
    setSearchParams({
      verificationId: 'evt_1',
      token: 'tok_1',
      next: '/looks',
    })

    render(<VerifyEmailPage />)

    expect(
      screen.getByRole('heading', { name: 'Confirm your email' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirm email verification' }),
    ).toBeInTheDocument()

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('posts verificationId and token only after confirm click, then shows phone-verification continuation when needed', async () => {
    setSearchParams({
      verificationId: 'evt_1',
      token: 'tok_1',
      next: '/claim/tok_1',
      intent: 'CLAIM_INVITE',
      inviteToken: 'tok_1',
    })

    mockFetch
      .mockResolvedValueOnce(
        makeJsonResponse(200, {
          ok: true,
          alreadyVerified: false,
          isPhoneVerified: false,
          isEmailVerified: true,
          isFullyVerified: false,
          requiresPhoneVerification: true,
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(200, {
          user: {
            role: 'CLIENT',
            email: 'user@example.com',
          },
          nextUrl: '/claim/tok_1',
        }),
      )

    render(<VerifyEmailPage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm email verification' }),
    )

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/auth/email/verify',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          verificationId: 'evt_1',
          token: 'tok_1',
        }),
      }),
    )

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/verification/status',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      }),
    )

    expect(
      await screen.findByText('Your email is verified successfully.'),
    ).toBeInTheDocument()

    const continueLink = screen.getByRole('link', {
      name: 'Continue to phone verification',
    })
    expect(continueLink).toHaveAttribute(
      'href',
      '/verify-phone?next=%2Fclaim%2Ftok_1&intent=CLAIM_INVITE&inviteToken=tok_1',
    )
  })

  it('shows a non-consuming failure state when required query params are missing', () => {
    setSearchParams({
      next: '/looks',
    })

    render(<VerifyEmailPage />)

    expect(
      screen.getByRole('heading', { name: 'Email verification failed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('That verification link is missing required information.'),
    ).toBeInTheDocument()

    const goToVerificationLink = screen.getByRole('link', {
      name: 'Go to verification',
    })
    expect(goToVerificationLink).toHaveAttribute(
      'href',
      '/verify-phone?next=%2Flooks&email=retry',
    )

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('shows resend guidance after a locked verification response', async () => {
    setSearchParams({
      verificationId: 'evt_lock',
      token: 'bad_token',
      next: '/looks',
    })

    mockFetch.mockResolvedValueOnce(
      makeJsonResponse(429, {
        ok: false,
        error:
          'Too many incorrect verification attempts. Request a new verification email.',
        code: 'TOKEN_LOCKED',
        resendRequired: true,
      }),
    )

    render(<VerifyEmailPage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm email verification' }),
    )

    expect(
      await screen.findByText(
        'Too many incorrect verification attempts. Request a new verification email.',
      ),
    ).toBeInTheDocument()

    const resendLink = screen.getByRole('link', {
      name: 'Request a new verification email',
    })
    expect(resendLink).toHaveAttribute(
      'href',
      '/verify-phone?next=%2Flooks&email=retry',
    )

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('shows Continue when the account becomes fully verified', async () => {
    setSearchParams({
      verificationId: 'evt_1',
      token: 'tok_1',
      next: '/looks',
    })

    mockFetch
      .mockResolvedValueOnce(
        makeJsonResponse(200, {
          ok: true,
          alreadyVerified: false,
          isPhoneVerified: true,
          isEmailVerified: true,
          isFullyVerified: true,
          requiresPhoneVerification: false,
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(200, {
          user: {
            role: 'CLIENT',
            email: 'user@example.com',
          },
          nextUrl: '/looks',
        }),
      )

    render(<VerifyEmailPage />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm email verification' }),
    )

    const continueLink = await screen.findByRole('link', {
      name: 'Continue',
    })

    expect(continueLink).toHaveAttribute('href', '/looks')
  })
})