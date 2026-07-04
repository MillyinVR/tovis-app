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

    expect(result).toEqual({ ok: true, url: '/looks' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/google',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('routes an un-verified social user to phone verification', async () => {
    mockFetch(200, {
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
      url: '/verify-phone?next=%2Flooks%2Fxyz',
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
})
