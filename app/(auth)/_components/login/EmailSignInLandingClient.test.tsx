// app/(auth)/_components/login/EmailSignInLandingClient.test.tsx
//
// 🔴 The headline test here is `does NOT sign in on mount`.
//
// This page is where the emailed magic link lands, and the single-use token is
// in its URL. Mail scanners, corporate link-rewriters (Outlook Safe Links,
// Proofpoint, Mimecast) and chat link-preview bots all FETCH urls found in
// email, usually within seconds of delivery. If rendering this page redeemed
// the token, a robot would burn it before the human ever clicked, and the
// person would be told their link is invalid — a bug that presents as flaky
// email and is horrible to track down.
//
// A comment saying "no useEffect here" does not survive the next refactor. This
// does: it asserts that mounting the component performs no network call at all,
// and that the credential only moves after a deliberate click.

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
}))

// AuthShell reaches for the brand context, which is chrome, not the subject.
vi.mock('../AuthShell', () => ({
  default: ({
    title,
    subtitle,
    children,
  }: {
    title: string
    subtitle?: string
    children: React.ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {children}
    </div>
  ),
}))

vi.mock('@/lib/brand/BrandProvider', () => ({
  useBrand: () => ({
    brand: { id: 'tovis', displayName: 'TOVIS' },
    mode: 'dark',
    preference: 'system',
    setPreference: vi.fn(),
    setMode: vi.fn(),
  }),
  BrandProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

import EmailSignInLandingClient from './EmailSignInLandingClient'

const TOKEN = 'tok_1.fixture-value-not-a-credential'

/**
 * Typed so the assertions below can read the call arguments without a cast.
 * Double-assertion through `unknown` is forbidden by the house rules, and a
 * bare `vi.fn()` with no signature infers its calls as `[]`, so the signature
 * goes here instead.
 */
type FetchFn = (input: string, init: RequestInit) => Promise<Response>

function mockFetchOk() {
  const fetchMock = vi.fn<FetchFn>(async () =>
    new Response(
      JSON.stringify({
        user: { id: 'user_1', email: 'p@example.com', role: 'CLIENT' },
        token: 'session-token',
        nextUrl: null,
        isPhoneVerified: true,
        isEmailVerified: true,
        isFullyVerified: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('EmailSignInLandingClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.searchParams = new URLSearchParams()

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: mocks.assign, href: 'http://localhost/signin/x' },
    })
  })

  it('🔴 does NOT sign in on mount — a mail scanner must not burn the token', async () => {
    const fetchMock = mockFetchOk()

    render(<EmailSignInLandingClient token={TOKEN} />)

    // Give any stray effect a chance to fire before asserting absence.
    await waitFor(() => {
      expect(screen.getByText('Sign me in')).toBeTruthy()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.assign).not.toHaveBeenCalled()
  })

  it('POSTs the token only after an explicit click', async () => {
    const fetchMock = mockFetchOk()

    render(<EmailSignInLandingClient token={TOKEN} />)
    fireEvent.click(screen.getByText('Sign me in'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    const [url, init] = call ?? ['', {}]
    expect(url).toBe('/api/v1/auth/email-sign-in/verify')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN })
  })

  it('navigates on success', async () => {
    mockFetchOk()

    render(<EmailSignInLandingClient token={TOKEN} />)
    fireEvent.click(screen.getByText('Sign me in'))

    await waitFor(() => {
      expect(mocks.assign).toHaveBeenCalledTimes(1)
    })
  })

  it('shows the failure without navigating', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchFn>(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: 'This sign-in link is invalid or has expired.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    render(<EmailSignInLandingClient token={TOKEN} />)
    fireEvent.click(screen.getByText('Sign me in'))

    await waitFor(() => {
      expect(
        screen.getByText('This sign-in link is invalid or has expired.'),
      ).toBeTruthy()
    })
    expect(mocks.assign).not.toHaveBeenCalled()
  })

  it('offers no sign-in control when the token segment is empty', () => {
    mockFetchOk()

    render(<EmailSignInLandingClient token="  " />)

    expect(screen.queryByText('Sign me in')).toBeNull()
    expect(screen.getByText('Back to login')).toBeTruthy()
  })
})
