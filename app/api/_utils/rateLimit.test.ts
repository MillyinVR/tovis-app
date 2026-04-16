import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRateLimitRedis = vi.hoisted(() => vi.fn())
const mockGetTrustedClientIpFromNextHeaders = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())

vi.mock('@/lib/rateLimitRedis', () => ({
  rateLimitRedis: mockRateLimitRedis,
}))

vi.mock('@/lib/trustedClientIp', () => ({
  getTrustedClientIpFromNextHeaders: mockGetTrustedClientIpFromNextHeaders,
}))

vi.mock('@/lib/observability/authEvents', () => ({
  logAuthEvent: mockLogAuthEvent,
}))

vi.mock('./responses', () => ({
  jsonFail: (
    status: number,
    error: string,
    extra?: Record<string, unknown>,
    init?: { headers?: Record<string, string> },
  ) =>
    new Response(
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
    ),
}))

const ORIGINAL_ENV = { ...process.env }

async function loadSubject() {
  vi.resetModules()
  return await import('./rateLimit')
}

describe('app/api/_utils/rateLimit', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    mockRateLimitRedis.mockReset()
    mockGetTrustedClientIpFromNextHeaders.mockReset()
    mockLogAuthEvent.mockReset()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('prefers user identity over IP identity', async () => {
    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue('203.0.113.10')

    const { rateLimitIdentity } = await loadSubject()

    const result = await rateLimitIdentity(' user_123 ')

    expect(result).toEqual({
      kind: 'user',
      id: 'user_123',
    })
    expect(mockGetTrustedClientIpFromNextHeaders).not.toHaveBeenCalled()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('uses trusted client IP when no user identity is present', async () => {
    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue('203.0.113.20')

    const { rateLimitIdentity } = await loadSubject()

    const result = await rateLimitIdentity()

    expect(mockGetTrustedClientIpFromNextHeaders).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      kind: 'ip',
      id: '203.0.113.20',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('returns null when neither user nor trusted IP identity is available', async () => {
    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue(null)

    const { rateLimitIdentity } = await loadSubject()

    const result = await rateLimitIdentity()

    expect(result).toBeNull()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('builds a phone identity for shared SMS quotas', async () => {
    const { phoneRateLimitIdentity } = await loadSubject()

    expect(phoneRateLimitIdentity('+15551234567')).toEqual({
      kind: 'phone',
      id: '+15551234567',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('returns null when Redis allows the request', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    mockRateLimitRedis.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      resetMs: 1_700_000_060_000,
    })

    const { enforceRateLimit } = await loadSubject()

    const result = await enforceRateLimit({
      bucket: 'auth:register',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })

    expect(result).toBeNull()
    expect(mockRateLimitRedis).toHaveBeenCalledTimes(1)
    expect(mockRateLimitRedis).toHaveBeenCalledWith({
      key: 'rl:auth:register:ip:198.51.100.10',
      limit: 5,
      windowSeconds: 60 * 60,
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()

    nowSpy.mockRestore()
  })

  it('returns a 429 response with rate-limit headers when Redis rejects the request', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    mockRateLimitRedis.mockResolvedValue({
      success: false,
      limit: 5,
      remaining: 0,
      resetMs: 1_700_000_030_000,
    })

    const { enforceRateLimit } = await loadSubject()

    const res = await enforceRateLimit({
      bucket: 'auth:register',
      identity: { kind: 'ip', id: '198.51.100.11' },
    })

    expect(res).toBeInstanceOf(Response)
    expect(res?.status).toBe(429)
    expect(res?.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(res?.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(res?.headers.get('X-RateLimit-Reset')).toBe('1700000030000')
    expect(res?.headers.get('Retry-After')).toBe('30')

    const body = await res!.json()
    expect(body).toEqual({
      ok: false,
      error: 'Too many requests. Please slow down.',
      code: 'RATE_LIMITED',
      details: {
        limit: 5,
        remaining: 0,
        reset: 1_700_000_030_000,
      },
    })

    expect(mockLogAuthEvent).not.toHaveBeenCalled()

    nowSpy.mockRestore()
  })

  it('degrades auth-critical buckets to bounded local limits when Redis fails and logs the circuit-open event', async () => {
    mockRateLimitRedis.mockRejectedValue(new Error('redis down'))

    const { enforceRateLimit } = await loadSubject()

    const identity = { kind: 'ip', id: '198.51.100.12' } as const

    for (let i = 0; i < 5; i += 1) {
      const result = await enforceRateLimit({
        bucket: 'auth:register',
        identity,
      })
      expect(result).toBeNull()
    }

    const blocked = await enforceRateLimit({
      bucket: 'auth:register',
      identity,
    })

    expect(blocked).toBeInstanceOf(Response)
    expect(blocked?.status).toBe(429)

    const body = await blocked!.json()
    expect(body.ok).toBe(false)
    expect(body.code).toBe('RATE_LIMITED')

    expect(mockRateLimitRedis).toHaveBeenCalledTimes(1)
    expect(mockLogAuthEvent).toHaveBeenCalledTimes(1)
    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.rate_limit.local_only_degraded',
      route: 'auth.rateLimit',
      provider: 'redis',
      meta: {
        bucket: 'auth:register',
        mode: 'auth-critical',
        keySuffix: null,
        circuitOpened: true,
        identityKind: 'ip',
        identityId: '198.51.100.12',
      },
    })
  })

  it('uses separate keys for phone-based SMS quota buckets', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    mockRateLimitRedis.mockResolvedValue({
      success: true,
      limit: 3,
      remaining: 2,
      resetMs: 1_700_000_060_000,
    })

    const { enforceRateLimit, phoneRateLimitIdentity } = await loadSubject()

    const result = await enforceRateLimit({
      bucket: 'auth:sms-phone-hour',
      identity: phoneRateLimitIdentity('+15551234567'),
    })

    expect(result).toBeNull()
    expect(mockRateLimitRedis).toHaveBeenCalledWith({
      key: 'rl:auth:sms:phone:hour:phone:+15551234567',
      limit: 3,
      windowSeconds: 60 * 60,
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()

    nowSpy.mockRestore()
  })

  it('skips non-auth-critical Redis rate limits when Redis fails and logs a structured warning', async () => {
    mockRateLimitRedis.mockRejectedValue(new Error('redis down'))

    const { enforceRateLimit } = await loadSubject()

    const result = await enforceRateLimit({
      bucket: 'looks:like',
      identity: { kind: 'user', id: 'user_77' },
    })

    expect(result).toBeNull()
    expect(mockRateLimitRedis).toHaveBeenCalledTimes(1)
    expect(mockRateLimitRedis).toHaveBeenCalledWith({
      key: 'rl:looks:like:user:user_77',
      limit: 60,
      windowSeconds: 60,
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'warn',
      event: 'auth.rate_limit.redis_skipped',
      route: 'auth.rateLimit',
      provider: 'redis',
      userId: 'user_77',
      phone: undefined,
      meta: {
        bucket: 'looks:like',
        mode: 'redis-only',
        keySuffix: null,
        circuitOpened: false,
        identityKind: 'user',
      },
    })
  })
})