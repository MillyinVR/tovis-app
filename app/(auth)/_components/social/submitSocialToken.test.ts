import { afterEach, describe, expect, it, vi } from 'vitest'

import { submitSocialToken } from './submitSocialToken'

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('submitSocialToken', () => {
  it('posts the Google identity token to the google endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: 'SIGNED_IN',
          user: { id: 'u', role: 'CLIENT' },
          isFullyVerified: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await submitSocialToken({
      provider: 'google',
      identityToken: 'tok',
      nextSafe: null,
      fromSafe: null,
    })

    expect(result).toEqual({ ok: true, kind: 'signed-in', url: '/looks' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/google',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('routes an un-verified social user to phone verification', async () => {
    mockFetch(200, {
      status: 'SIGNED_IN',
      user: { id: 'u', role: 'CLIENT' },
      isPhoneVerified: false,
      isEmailVerified: true,
      isFullyVerified: false,
    })

    const result = await submitSocialToken({
      provider: 'apple',
      identityToken: 'tok',
      nextSafe: '/looks/xyz',
      fromSafe: null,
    })

    expect(result).toEqual({
      ok: true,
      kind: 'signed-in',
      url: '/verify-phone?next=%2Flooks%2Fxyz',
    })
  })

  // A response with no `status` is what a server that predates the discriminant
  // sends. It must still sign in, which is the whole point of adding the field
  // rather than changing the existing payload.
  it('treats a response with no status as a sign-in', async () => {
    mockFetch(200, {
      user: { id: 'u', role: 'PRO' },
      isFullyVerified: true,
    })

    const result = await submitSocialToken({
      provider: 'google',
      identityToken: 'tok',
      nextSafe: null,
      fromSafe: null,
    })

    expect(result).toEqual({
      ok: true,
      kind: 'signed-in',
      url: '/pro/calendar',
    })
  })

  it('surfaces the server error message on a non-2xx response', async () => {
    mockFetch(409, {
      error: 'An account already exists for this email.',
      code: 'ACCOUNT_EXISTS_UNVERIFIED',
    })

    const result = await submitSocialToken({
      provider: 'apple',
      identityToken: 'tok',
      nextSafe: null,
      fromSafe: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('already exists')
    }
  })

  it('hands back the signup ticket when the identity has no account', async () => {
    mockFetch(200, {
      status: 'SIGNUP_REQUIRED',
      signupTicket: 'tid.secret',
      ticketExpiresAt: '2026-08-25T12:15:00.000Z',
      prefill: { email: 'new@example.com', firstName: 'Ada', lastName: null },
    })

    const result = await submitSocialToken({
      provider: 'google',
      identityToken: 'tok',
      nextSafe: null,
      fromSafe: null,
    })

    expect(result).toEqual({
      ok: true,
      kind: 'signup-required',
      ticket: {
        provider: 'google',
        signupTicket: 'tid.secret',
        ticketExpiresAt: '2026-08-25T12:15:00.000Z',
        prefill: {
          email: 'new@example.com',
          firstName: 'Ada',
          lastName: null,
        },
      },
    })
  })

  // The old code fed this to resolvePostAuthNavigation, which found no
  // `user.role` and told a person with NO ACCOUNT that their account's role was
  // missing. A SIGNUP_REQUIRED without its ticket is a broken response, and the
  // one thing it must never become is advice about an account.
  it('refuses a SIGNUP_REQUIRED that is missing its ticket', async () => {
    mockFetch(200, {
      status: 'SIGNUP_REQUIRED',
      prefill: { email: 'new@example.com' },
    })

    const result = await submitSocialToken({
      provider: 'apple',
      identityToken: 'tok',
      nextSafe: null,
      fromSafe: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).not.toContain('role')
      expect(result.error).toBe(
        'Sign-in could not be completed. Please try again.',
      )
    }
  })
})
