import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTrustedClientIpFromRequest: vi.fn(),
}))

vi.mock('@/lib/trustedClientIp', () => ({
  getTrustedClientIpFromRequest: mocks.getTrustedClientIpFromRequest,
}))

import {
  AUTH_TURNSTILE_FAIL_OPEN_EVENT,
  verifyTurnstileOrFailOpen,
} from './turnstile'


function makeRequest(): Request {
  return new Request('https://app.test/api/auth/register', {
    method: 'POST',
  })
}

describe('verifyTurnstileOrFailOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()

    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret_test_123')
    vi.stubEnv('AUTH_TURNSTILE_FAIL_OPEN', '')

    mocks.getTrustedClientIpFromRequest.mockReturnValue('198.51.100.10')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('requires a captcha token before contacting Turnstile', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: null,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'CAPTCHA_REQUIRED',
      message: 'Complete the captcha and try again.',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the Turnstile secret is missing by default', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: 'token_123',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'CAPTCHA_UNAVAILABLE',
      message: 'Captcha is temporarily unavailable. Please try again.',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes when Turnstile returns success', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
    )

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: 'token_123',
      }),
    ).resolves.toEqual({
      ok: true,
      failOpen: false,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed when Turnstile rejects the token', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
    )

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: 'bad_token_123',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'CAPTCHA_FAILED',
      message: 'Captcha verification failed. Please try again.',
    })
  })

  it('fails closed on Turnstile 5xx responses by default', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('temporarily unavailable', {
          status: 503,
        }),
    )

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: 'token_123',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'CAPTCHA_UNAVAILABLE',
      message: 'Captcha is temporarily unavailable. Please try again.',
    })
  })

  it('fails closed on Turnstile network errors by default', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: 'token_123',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'CAPTCHA_UNAVAILABLE',
      message: 'Captcha is temporarily unavailable. Please try again.',
    })
  })

  it('allows fail-open in non-production only when explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('AUTH_TURNSTILE_FAIL_OPEN', '1')

    const fetchMock = vi.fn(
      async () =>
        new Response('temporarily unavailable', {
          status: 503,
        }),
    )

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: 'token_123',
      }),
    ).resolves.toEqual({
      ok: true,
      failOpen: true,
      eventName: AUTH_TURNSTILE_FAIL_OPEN_EVENT,
      reason: 'turnstile_http_503',
    })
  })

  it('does not allow fail-open in production even when the flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_TURNSTILE_FAIL_OPEN', '1')

    const fetchMock = vi.fn(
      async () =>
        new Response('temporarily unavailable', {
          status: 503,
        }),
    )

    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: 'token_123',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'CAPTCHA_UNAVAILABLE',
      message: 'Captcha is temporarily unavailable. Please try again.',
    })
  })

  it('allows missing-secret fail-open in non-production only when explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('AUTH_TURNSTILE_FAIL_OPEN', '1')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileOrFailOpen({
        request: makeRequest(),
        token: 'token_123',
      }),
    ).resolves.toEqual({
      ok: true,
      failOpen: true,
      eventName: AUTH_TURNSTILE_FAIL_OPEN_EVENT,
      reason: 'turnstile_secret_missing',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})