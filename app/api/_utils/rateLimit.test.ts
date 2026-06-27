// app/api/_utils/rateLimit.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockEnforceRateLimitDecision = vi.hoisted(() => vi.fn())
const mockGetRateLimitHeaders = vi.hoisted(() => vi.fn())
const mockGetTrustedClientIpFromNextHeaders = vi.hoisted(() => vi.fn())
const mockLogAuthEvent = vi.hoisted(() => vi.fn())

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mockEnforceRateLimitDecision,
  getRateLimitHeaders: mockGetRateLimitHeaders,
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

function setNodeEnv(value: 'development' | 'production' | 'test') {
  process.env = {
    ...process.env,
    NODE_ENV: value,
  }
}

function allowedDecision(overrides?: Record<string, unknown>) {
  return {
    allowed: true,
    bucket: 'auth:register',
    key: 'ip:198.51.100.10',
    limit: 5,
    remaining: 4,
    resetAt: new Date(1_700_000_060_000),
    retryAfterSeconds: 60,
    source: 'redis',
    ...(overrides ?? {}),
  }
}

function blockedDecision(overrides?: Record<string, unknown>) {
  return {
    allowed: false,
    bucket: 'auth:register',
    key: 'ip:198.51.100.11',
    limit: 5,
    remaining: 0,
    resetAt: new Date(1_700_000_030_000),
    retryAfterSeconds: 30,
    source: 'redis',
    reason: 'rate_limited',
    ...(overrides ?? {}),
  }
}

describe('app/api/_utils/rateLimit', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }

    mockEnforceRateLimitDecision.mockReset()
    mockGetRateLimitHeaders.mockReset()
    mockGetTrustedClientIpFromNextHeaders.mockReset()
    mockLogAuthEvent.mockReset()

    mockEnforceRateLimitDecision.mockResolvedValue(allowedDecision())
    mockGetRateLimitHeaders.mockReturnValue({
      'RateLimit-Limit': '5',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '1700000030',
      'Retry-After': '30',
    })
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

  it('returns null in development when neither user nor trusted IP identity is available', async () => {
    setNodeEnv('development')
    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue(null)

    const { rateLimitIdentity } = await loadSubject()

    const result = await rateLimitIdentity()

    expect(result).toBeNull()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('uses the shared unknown IP fallback bucket in production when trusted client IP resolves to null', async () => {
    setNodeEnv('production')
    mockGetTrustedClientIpFromNextHeaders.mockResolvedValue(null)

    const { enforceRateLimit, rateLimitIdentity } = await loadSubject()

    const identity = await rateLimitIdentity()

    expect(identity).toEqual({
      kind: 'ip',
      id: 'unknown',
    })

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      level: 'error',
      event: 'rate_limit_identity_null',
      route: 'auth.rateLimit',
      message:
        'Trusted client IP resolved to null in production; using shared fallback bucket.',
      meta: {
        fallbackIdentityKind: 'ip',
        fallbackIdentityId: 'unknown',
        nodeEnv: 'production',
      },
    })

    const result = await enforceRateLimit({
      bucket: 'auth:register',
      identity,
    })

    expect(result).toBeNull()
    expect(mockEnforceRateLimitDecision).toHaveBeenCalledWith({
      bucket: 'auth:register',
      key: 'ip:unknown',
    })
  })

  it('builds a phone identity for shared SMS quotas', async () => {
    const { phoneRateLimitIdentity } = await loadSubject()

    expect(phoneRateLimitIdentity('+15551234567')).toEqual({
      kind: 'phone',
      id: '+15551234567',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('throws when building a blank phone identity', async () => {
    const { phoneRateLimitIdentity } = await loadSubject()

    expect(() => phoneRateLimitIdentity('   ')).toThrow(
      'Rate limit identity value must be non-empty.',
    )
  })

  it('builds a token identity for public token brute-force quotas', async () => {
    const { tokenRateLimitIdentity } = await loadSubject()

    expect(tokenRateLimitIdentity('abc123')).toEqual({
      kind: 'token',
      id: 'abc123',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('throws when building a blank token identity', async () => {
    const { tokenRateLimitIdentity } = await loadSubject()

    expect(() => tokenRateLimitIdentity('   ')).toThrow(
      'Rate limit identity value must be non-empty.',
    )
  })

  it('hashes an email into a stable, PII-free key suffix', async () => {
    const { emailRateLimitKeySuffix } = await loadSubject()

    const suffix = emailRateLimitKeySuffix('user@example.com')

    // 32-char hex slice of a sha256 digest — deterministic and not the raw email.
    expect(suffix).toMatch(/^[0-9a-f]{32}$/)
    expect(suffix).not.toContain('user@example.com')
    expect(emailRateLimitKeySuffix('user@example.com')).toBe(suffix)
    expect(emailRateLimitKeySuffix('other@example.com')).not.toBe(suffix)
  })

  it('throws when hashing a blank email key suffix', async () => {
    const { emailRateLimitKeySuffix } = await loadSubject()

    expect(() => emailRateLimitKeySuffix('   ')).toThrow(
      'Rate limit identity value must be non-empty.',
    )
  })

  it('returns null when the canonical limiter allows the request', async () => {
    mockEnforceRateLimitDecision.mockResolvedValue(
      allowedDecision({
        bucket: 'auth:register',
        key: 'ip:198.51.100.10',
        limit: 5,
        remaining: 4,
      }),
    )

    const { enforceRateLimit } = await loadSubject()

    const result = await enforceRateLimit({
      bucket: 'auth:register',
      identity: { kind: 'ip', id: '198.51.100.10' },
    })

    expect(result).toBeNull()
    expect(mockEnforceRateLimitDecision).toHaveBeenCalledTimes(1)
    expect(mockEnforceRateLimitDecision).toHaveBeenCalledWith({
      bucket: 'auth:register',
      key: 'ip:198.51.100.10',
    })
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('passes keySuffix through to the canonical limiter key', async () => {
    const { enforceRateLimit } = await loadSubject()

    const result = await enforceRateLimit({
      bucket: 'auth:phone:verify',
      identity: { kind: 'phone', id: '+15551234567' },
      keySuffix: 'code-check',
    })

    expect(result).toBeNull()
    expect(mockEnforceRateLimitDecision).toHaveBeenCalledWith({
      bucket: 'auth:phone:verify',
      key: 'phone:+15551234567:code-check',
    })
  })

  it('returns a 429 response with rate-limit headers when the canonical limiter rejects the request', async () => {
    mockEnforceRateLimitDecision.mockResolvedValue(
      blockedDecision({
        bucket: 'auth:register',
        key: 'ip:198.51.100.11',
        limit: 5,
        remaining: 0,
        resetAt: new Date(1_700_000_030_000),
        retryAfterSeconds: 30,
        source: 'redis',
        reason: 'rate_limited',
      }),
    )

    mockGetRateLimitHeaders.mockReturnValue({
      'RateLimit-Limit': '5',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': '1700000030',
      'Retry-After': '30',
    })

    const { enforceRateLimit } = await loadSubject()

    const res = await enforceRateLimit({
      bucket: 'auth:register',
      identity: { kind: 'ip', id: '198.51.100.11' },
    })

    expect(res).toBeInstanceOf(Response)
    expect(res?.status).toBe(429)
    expect(res?.headers.get('RateLimit-Limit')).toBe('5')
    expect(res?.headers.get('RateLimit-Remaining')).toBe('0')
    expect(res?.headers.get('RateLimit-Reset')).toBe('1700000030')
    expect(res?.headers.get('Retry-After')).toBe('30')
    expect(res?.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(res?.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(res?.headers.get('X-RateLimit-Reset')).toBe('1700000030000')

    const body = await res!.json()
    expect(body).toEqual({
      ok: false,
      error: 'Too many requests. Please slow down.',
      code: 'RATE_LIMITED',
      details: {
        bucket: 'auth:register',
        limit: 5,
        remaining: 0,
        reset: 1_700_000_030_000,
        retryAfterSeconds: 30,
        source: 'redis',
        reason: 'rate_limited',
      },
    })

    expect(mockGetRateLimitHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed: false,
        bucket: 'auth:register',
      }),
    )
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('logs a structured warning when redis-only buckets fail open', async () => {
    mockEnforceRateLimitDecision.mockResolvedValue(
      allowedDecision({
        bucket: 'looks:like',
        key: 'user:user_77',
        limit: 60,
        remaining: 60,
        source: 'fail-open',
      }),
    )

    const { enforceRateLimit } = await loadSubject()

    const result = await enforceRateLimit({
      bucket: 'looks:like',
      identity: { kind: 'user', id: 'user_77' },
    })

    expect(result).toBeNull()
    expect(mockEnforceRateLimitDecision).toHaveBeenCalledWith({
      bucket: 'looks:like',
      key: 'user:user_77',
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
        keySuffix: null,
        source: 'fail-open',
        identityKind: 'user',
      },
    })
  })

  it('does not log on allowed memory fallback decisions to avoid noisy degraded logs', async () => {
    mockEnforceRateLimitDecision.mockResolvedValue(
      allowedDecision({
        bucket: 'auth:register',
        key: 'ip:198.51.100.12',
        limit: 5,
        remaining: 4,
        source: 'memory',
      }),
    )

    const { enforceRateLimit } = await loadSubject()

    const result = await enforceRateLimit({
      bucket: 'auth:register',
      identity: { kind: 'ip', id: '198.51.100.12' },
    })

    expect(result).toBeNull()
    expect(mockLogAuthEvent).not.toHaveBeenCalled()
  })

  it('returns null without calling the canonical limiter when identity is null', async () => {
    const { enforceRateLimit } = await loadSubject()

    const result = await enforceRateLimit({
      bucket: 'auth:register',
      identity: null,
    })

    expect(result).toBeNull()
    expect(mockEnforceRateLimitDecision).not.toHaveBeenCalled()
  })
})