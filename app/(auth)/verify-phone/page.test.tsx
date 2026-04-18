// app/(auth)/verify-phone/page.test.tsx
import React from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReplace = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockSearchParamsGet = vi.hoisted(() => vi.fn())
const mockSetBrandMode = vi.hoisted(() => vi.fn())

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

vi.mock('@/lib/brand/BrandProvider', () => ({
  useBrand: () => ({
    brand: {
      id: 'tovis',
      displayName: 'TOVIS',
    },
    mode: 'dark',
    setMode: mockSetBrandMode,
  }),
  BrandProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

async function flushAsyncWork(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function advanceFakeTime(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

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
  phone?: string | null
}) {
  const isPhoneVerified = args?.isPhoneVerified ?? false
  const isEmailVerified = args?.isEmailVerified ?? false
  const isFullyVerified = args?.isFullyVerified ?? false

  return {
    ok: true,
    user: {
      id: 'user_1',
      email: args?.email ?? 'user@example.com',
      phone: args?.phone ?? '+15551234567',
      role: args?.role ?? 'CLIENT',
    },
    sessionKind: args?.sessionKind ?? 'VERIFICATION',
    isPhoneVerified,
    isEmailVerified,
    isFullyVerified,
    requiresPhoneVerification: !isPhoneVerified,
    requiresEmailVerification: !isEmailVerified,
    nextUrl:
      args && 'nextUrl' in args
        ? (args.nextUrl ?? null)
        : '/looks',
  }
}

describe('app/(auth)/verify-phone/page', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    mockReplace.mockReset()
    mockRefresh.mockReset()
    mockSearchParamsGet.mockReset()
    mockSetBrandMode.mockReset()
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
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
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
          phone: '+15551234567',
        }),
      ),
    )

    render(<VerifyPhonePage />)

    expect(
      await screen.findByText(
        'TOVIS could not send your first verification email. Resend it, then check your inbox and spam.',
      ),
    ).toBeInTheDocument()

    expect(screen.getAllByText('Pending')).toHaveLength(2)
    expect(screen.getByText('Verification incomplete')).toBeInTheDocument()
    expect(
      screen.getByText('Verification email destination:'),
    ).toBeInTheDocument()
    expect(screen.getByText('client@example.com')).toBeInTheDocument()
    expect(screen.getByText('Texts go to')).toBeInTheDocument()
    expect(screen.getByText('*** *** 4567')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /resend verification email/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^resend code$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /wrong number\?/i }),
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
          phone: '+15551234567',
        }),
      ),
    )

    render(<VerifyPhonePage />)

    expect(
      await screen.findByText(
        'TOVIS could not send your first verification text. Resend a code or fix your phone number below.',
      ),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /^resend code$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /wrong number\?/i }),
    ).toBeInTheDocument()
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

    await screen.findByText('client@example.com')

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
        'href',
        '/login?from=%2Fclaim%2Ftok_1&next=%2Fclaim%2Ftok_1&email=client%40example.com&intent=CLAIM_INVITE&inviteToken=tok_1',
      )
    })
  })

  it('recovers nextUrl once after a short delay when neither query nor status includes it', async () => {
    vi.useFakeTimers()

    fetchMock
      .mockResolvedValueOnce(
        makeResponse(
          makeStatusBody({
            isPhoneVerified: false,
            isEmailVerified: false,
            isFullyVerified: false,
            nextUrl: null,
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          nextUrl: '/claim/tok_1',
        }),
      )

    render(<VerifyPhonePage />)

    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Verification incomplete')).toBeInTheDocument()

    await advanceFakeTime(3000)
    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/session/next-url',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
      }),
    )

    const backLink = screen.getByRole('link', { name: /back to sign in/i })
    expect(backLink).toHaveAttribute(
      'href',
      '/login?from=%2Fclaim%2Ftok_1&next=%2Fclaim%2Ftok_1&email=client%40example.com',
    )
  })

  it('does not poll for nextUrl recovery when query already provides next', async () => {
    vi.useFakeTimers()

    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'next') return '/claim/tok_1'
      if (key === 'email') return null
      if (key === 'sms') return null
      if (key === 'intent') return null
      if (key === 'inviteToken') return null
      return null
    })

    fetchMock.mockResolvedValueOnce(
      makeResponse(
        makeStatusBody({
          isPhoneVerified: false,
          isEmailVerified: false,
          isFullyVerified: false,
          nextUrl: null,
          role: 'CLIENT',
          email: 'client@example.com',
        }),
      ),
    )

    render(<VerifyPhonePage />)

    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Verification incomplete')).toBeInTheDocument()

    await advanceFakeTime(3000)
    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const backLink = screen.getByRole('link', { name: /back to sign in/i })
    expect(backLink).toHaveAttribute(
      'href',
      '/login?from=%2Fclaim%2Ftok_1&next=%2Fclaim%2Ftok_1&email=client%40example.com',
    )
  })

  it('uses recovered nextUrl when resending verification email after delayed recovery', async () => {
    vi.useFakeTimers()

    fetchMock
      .mockResolvedValueOnce(
        makeResponse(
          makeStatusBody({
            isPhoneVerified: true,
            isEmailVerified: false,
            isFullyVerified: false,
            nextUrl: null,
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          nextUrl: '/claim/tok_1',
        }),
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
            nextUrl: null,
            role: 'CLIENT',
            email: 'client@example.com',
          }),
        ),
      )

    render(<VerifyPhonePage />)

    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Your phone is verified.')).toBeInTheDocument()

    await advanceFakeTime(3000)
    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(2)

    fireEvent.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )

    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/auth/email/send',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          next: '/claim/tok_1',
          intent: null,
          inviteToken: null,
        }),
      }),
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

  it('resends verification email, shows success feedback, and starts the cooldown', async () => {
    vi.useFakeTimers()

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

    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(
      screen.getByRole('button', { name: /resend verification email/i }),
    )

    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(3)
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
      screen.getByText(
        'TOVIS sent a new verification email. Check your inbox and spam.',
      ),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /resend email in 1:00/i }),
    ).toBeDisabled()

    await advanceFakeTime(1000)

    expect(
      screen.getByRole('button', { name: /resend email in 0:59/i }),
    ).toBeDisabled()
  })

  it('resends phone verification code, shows success feedback, and starts the cooldown', async () => {
    vi.useFakeTimers()

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

    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /^resend code$/i }))

    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(3)
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
      screen.getByText('We sent a new TOVIS verification code.'),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /resend code in 1:00/i }),
    ).toBeDisabled()

    await advanceFakeTime(1000)

    expect(
      screen.getByRole('button', { name: /resend code in 0:59/i }),
    ).toBeDisabled()
  })

  it('maps phone resend rate limits into cooldown UX instead of raw retry leakage', async () => {
    vi.useFakeTimers()

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
        makeResponse(
          {
            ok: false,
            error: 'Too many requests. Try again shortly.',
            code: 'RATE_LIMITED',
            retryAfterSeconds: 60,
          },
          429,
        ),
      )

    render(<VerifyPhonePage />)

    await flushAsyncWork()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /^resend code$/i }))

    await flushAsyncWork()

    expect(fetchMock).toHaveBeenCalledTimes(2)

    expect(
      screen.getByText(
        'You already requested a TOVIS verification code. Wait 1:00 and try again.',
      ),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: /resend code in 1:00/i }),
    ).toBeDisabled()
  })

  it('opens the wrong-number flow, updates the phone, and shows success feedback', async () => {
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
            phone: '+15551234567',
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          sent: true,
          phone: '+15557654321',
          isPhoneVerified: false,
          isEmailVerified: false,
          isFullyVerified: false,
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
            phone: '+15557654321',
          }),
        ),
      )

    render(<VerifyPhonePage />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: /wrong number\?/i }))

    const phoneInput = screen.getByPlaceholderText('+1 555 123 4567')
    await user.type(phoneInput, '+1 555 765 4321')

    await user.click(
      screen.getByRole('button', { name: /update number and resend/i }),
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/phone/correct',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone: '+1 555 765 4321' }),
      }),
    )

    expect(
      await screen.findByText(
        'We updated your TOVIS phone number and sent a fresh code.',
      ),
    ).toBeInTheDocument()

    expect(screen.getByText('*** *** 4321')).toBeInTheDocument()
  })

  it('shows server validation errors from the wrong-number flow', async () => {
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
            phone: '+15551234567',
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeResponse(
          {
            ok: false,
            error: 'That phone number is already in use.',
            code: 'PHONE_IN_USE',
          },
          409,
        ),
      )

    render(<VerifyPhonePage />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: /wrong number\?/i }))
    await user.type(
      screen.getByPlaceholderText('+1 555 123 4567'),
      '+1 555 765 4321',
    )
    await user.click(
      screen.getByRole('button', { name: /update number and resend/i }),
    )

    expect(
      await screen.findByText('That phone number is already in use.'),
    ).toBeInTheDocument()
  })
})