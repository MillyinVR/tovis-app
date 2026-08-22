import { beforeEach, describe, expect, it, vi } from 'vitest'

// Focused contract test for ONE thing: the per-pro ceiling on booking writes
// that notify the client.
//
// `pro:bookings:write` already guarded the aftercare + checkout tail of a
// booking; the head — create, patch, cancel, no-show, final-review,
// consultation-proposal and the recurring-series pair — enqueued an SMS/email/
// push to a real person with no ceiling at all. These assertions pin BOTH
// halves of the fix: that the limiter runs with the right bucket and key, and
// that a refusal short-circuits before any work is done.
//
// Note on why the "does no work" half needs its own mechanism: the limiter
// returning its own response does NOT by itself prove ordering — a limiter
// placed *after* the write would return exactly the same response. So `prisma`
// is a proxy that throws on any access; if the write ran first, the throw
// changes the result and the test fails.

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  enforceRateLimit: vi.fn(),
  proRateLimitKey: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
  prismaTouched: { value: null as string | null },
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitHeaders: vi.fn(() => ({})),
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  proRateLimitKey: mocks.proRateLimitKey,
  rateLimitKey: vi.fn(),
  clientRateLimitKey: vi.fn(),
  tokenActorRateLimitKey: vi.fn(),
  getClientIpFromRequest: vi.fn(() => 'unknown-ip'),
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
  rateLimitHeaders: vi.fn(() => ({})),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, property) {
        const name = String(property)
        // Vitest/Node probe these while inspecting the object; they are not
        // the route doing work.
        if (name === 'then' || name === Symbol.toStringTag.toString()) {
          return undefined
        }
        mocks.prismaTouched.value = name
        throw new Error(`prisma.${name} was reached before the rate limiter`)
      },
    },
  ),
}))

import { POST } from './route'

describe('POST /api/v1/pro/bookings/[id]/final-review — pro:bookings:write ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prismaTouched.value = null

    mocks.requirePro.mockResolvedValue({
      ok: true,
      user: { id: 'user_1' },
      userId: 'user_1',
      professionalId: 'pro_1',
      proId: 'pro_1',
    })

    mocks.proRateLimitKey.mockReturnValue('user:user_1|pro:pro_1|ip:unknown-ip')
  })

  function makeRequest(): Request {
    return new Request('http://localhost/api/v1/pro/bookings/booking_1/final-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  }

  it('refuses with the limiter response and touches no data when over the ceiling', async () => {
    const blocked = {
      allowed: false,
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
      limit: 30,
      remaining: 0,
      resetAt: new Date('2026-08-22T00:00:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
      reason: 'rate_limited',
    } as const

    const limitedResponse = new Response('{}', { status: 429 })

    mocks.enforceRateLimit.mockResolvedValueOnce(blocked)
    mocks.rateLimitExceededResponse.mockReturnValueOnce(limitedResponse)

    const result = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'booking_1' }),
    })

    expect(result).toBe(limitedResponse)
    expect(mocks.rateLimitExceededResponse).toHaveBeenCalledWith(blocked)
    expect(mocks.prismaTouched.value).toBeNull()
  })

  it('keys the ceiling per professional, not per IP alone', async () => {
    mocks.enforceRateLimit.mockResolvedValue({
      allowed: true,
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
      limit: 30,
      remaining: 29,
      resetAt: new Date('2026-08-22T00:00:00.000Z'),
      retryAfterSeconds: 60,
      source: 'redis',
    })

    // Everything past the limiter is unmocked and will fail on the throwing
    // prisma proxy; the route's own try/catch turns that into a 500. That is
    // fine — this test is about the call the limiter received.
    await POST(makeRequest(), {
      params: Promise.resolve({ id: 'booking_1' }),
    }).catch(() => undefined)

    expect(mocks.proRateLimitKey).toHaveBeenCalledWith({
      professionalId: 'pro_1',
      userId: 'user_1',
      request: expect.any(Request),
    })
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'pro:bookings:write',
      key: 'user:user_1|pro:pro_1|ip:unknown-ip',
    })
  })
})
