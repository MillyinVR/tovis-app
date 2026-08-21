import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPresenceSignals: vi.fn(),
  enforceRateLimit: vi.fn(),
  clientRateLimitKey: vi.fn(),
}))

vi.mock('@/lib/presence/presenceSignals', () => ({
  getPresenceSignals: mocks.getPresenceSignals,
}))

// Partial: rateLimitExceededResponse() reads getRateLimitHeaders() out of this
// same module, so stubbing the whole thing breaks the 429 path itself.
vi.mock('@/lib/rateLimit/enforce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit/enforce')>()),
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  clientRateLimitKey: mocks.clientRateLimitKey,
}))

import { GET } from './route'

function req(qs = 'resourceType=offering&resourceId=off_1&professionalId=pro_1') {
  return new Request(`http://localhost/api/v1/presence/signals?${qs}`)
}

describe('GET /api/v1/presence/signals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clientRateLimitKey.mockReturnValue('ip:203.0.113.7')
    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'presence:signals',
      key: 'ip:203.0.113.7',
      limit: 120,
      remaining: 119,
      resetAt: new Date('2026-08-21T12:01:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })
    mocks.getPresenceSignals.mockResolvedValue({ watching: 2, waitlisted: 5 })
  })

  it('is rate limited by IP — the route is unauthenticated, so the IP is the only identity', async () => {
    await GET(req())

    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'presence:signals' }),
    )
    expect(mocks.clientRateLimitKey).toHaveBeenCalled()
  })

  // The route runs a Postgres count on every call with no session behind it.
  // If this goes green-without-limiting again, that count is unbounded.
  it('refuses over the ceiling without reaching the database', async () => {
    mocks.enforceRateLimit.mockResolvedValue({
      allowed: false,
      bucket: 'presence:signals',
      key: 'ip:203.0.113.7',
      limit: 120,
      remaining: 0,
      resetAt: new Date('2026-08-21T12:01:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })

    const res = await GET(req())

    expect(res.status).toBe(429)
    expect(mocks.getPresenceSignals).not.toHaveBeenCalled()
  })

  it('checks the limit BEFORE validating params, so junk cannot bypass it', async () => {
    mocks.enforceRateLimit.mockResolvedValue({
      allowed: false,
      bucket: 'presence:signals',
      key: 'ip:203.0.113.7',
      limit: 120,
      remaining: 0,
      resetAt: new Date('2026-08-21T12:01:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })

    const res = await GET(req('resourceType=nonsense'))

    expect(res.status).toBe(429)
  })

  it('serves signals normally when under the ceiling', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(mocks.getPresenceSignals).toHaveBeenCalled()
  })
})
