import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRateLimitRedis = vi.hoisted(() => vi.fn())
const mockGetTrustedClientIpFromRequest = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())

vi.mock('@/lib/rateLimitRedis', () => ({
  rateLimitRedis: mockRateLimitRedis,
}))

vi.mock('@/lib/trustedClientIp', () => ({
  getTrustedClientIpFromRequest: mockGetTrustedClientIpFromRequest,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: (
    status: number,
    error: string,
    extra?: Record<string, unknown>,
    init?: { headers?: Record<string, string> },
  ) => {
    return new Response(
      JSON.stringify({
        ok: false,
        error,
        ...(extra ?? {}),
      }),
      {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      },
    )
  },
}))

import { enforceVerificationVerifyThrottle } from './verificationThrottle'

function makeRequest() {
  return new Request('http://localhost/api/auth/phone/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '198.51.100.10',
    },
    body: JSON.stringify({ code: '123456' }),
  })
}

describe('app/api/_utils/auth/verificationThrottle', () => {
  beforeEach(() => {
    mockRateLimitRedis.mockReset()
    mockGetTrustedClientIpFromRequest.mockReset()
    mockLogAuthEvent.mockReset()

    mockGetTrustedClientIpFromRequest.mockReturnValue('198.51.100.10')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when Redis allows the verification attempt', async () => {
    mockRateLimitRedis.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      resetMs: Date.now() + 60_000,
    })

    const result = await enforceVerificationVerifyThrottle({
      request: makeRequest(),
      scope: 'phone-verify',
      subjectKey: 'user_1',
    })

    expect(mockGetTrustedClientIpFromRequest).toHaveBeenCalledWith(
      expect.any(Request),
    )

    expect(mockRateLimitRedis).toHaveBeenCalledWith({
      key: 'auth:verify:phone-verify:user_1:ip:198.51.100.10',
      limit: 10,
      windowSeconds: 600,
    })

    expect(result).toBeNull()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('returns 429 with Retry-After and rate-limit headers when Redis blocks the attempt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    mockGetTrustedClientIpFromRequest.mockReturnValue(null)
    mockRateLimitRedis.mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      resetMs: 1_700_000_045_000,
    })

    const result = await enforceVerificationVerifyThrottle({
      request: makeRequest(),
      scope: 'email-verify',
      subjectKey: 'evt_1',
    })

    expect(mockRateLimitRedis).toHaveBeenCalledWith({
      key: 'auth:verify:email-verify:evt_1:ip:unknown',
      limit: 10,
      windowSeconds: 600,
    })

    expect(result).toBeInstanceOf(Response)
    expect(result?.status).toBe(429)
    expect(result?.headers.get('Retry-After')).toBe('45')
    expect(result?.headers.get('X-RateLimit-Limit')).toBe('10')
    expect(result?.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(result?.headers.get('X-RateLimit-Reset')).toBe('1700000045000')

    const body = await result?.json()
    expect(body).toEqual({
      ok: false,
      error: 'Too many verification attempts. Please wait and try again.',
      code: 'RATE_LIMITED',
      retryAfterSeconds: 45,
    })

    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('fails open and logs a structured warning when Redis throws', async () => {
    mockRateLimitRedis.mockRejectedValue(new Error('redis down'))

    const result = await enforceVerificationVerifyThrottle({
      request: makeRequest(),
      scope: 'phone-verify',
      subjectKey: 'user_1',
    })

    expect(result).toBeNull()

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.verification_throttle.degraded',
      route: 'auth.verificationThrottle',
      provider: 'redis',
      verificationId: 'user_1',
      meta: {
        scope: 'phone-verify',
      },
    })
  })
})