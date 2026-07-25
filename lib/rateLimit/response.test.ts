// lib/rateLimit/response.test.ts
//
// These assert on the RESPONSE OBJECT, not on the fact that the helper was
// invoked. That distinction is the whole reason this file exists: every route
// test for a rate-limited endpoint mocked `rateLimitExceededResponse` and
// asserted it had been called, so all of them stayed green while the helper
// dropped its headers on the floor for all 20 of its call sites.

import { describe, expect, it } from 'vitest'

import type { BlockedRateLimitDecision } from './enforce'
import { rateLimitExceededResponse } from './response'

function makeBlockedDecision(
  overrides?: Partial<BlockedRateLimitDecision>,
): BlockedRateLimitDecision {
  return {
    allowed: false,
    bucket: 'waitlist:write',
    key: 'user:user_1|client:client_1|ip:1.2.3.4',
    limit: 20,
    remaining: 0,
    resetAt: new Date('2026-07-25T12:01:00.000Z'),
    retryAfterSeconds: 47,
    source: 'redis',
    reason: 'rate_limited',
    ...overrides,
  }
}

describe('rateLimitExceededResponse', () => {
  it('puts the RateLimit-* and Retry-After headers on the wire', () => {
    const res = rateLimitExceededResponse(makeBlockedDecision())

    expect(res.status).toBe(429)

    // Retry-After is the one a client actually needs to back off correctly.
    expect(res.headers.get('Retry-After')).toBe('47')
    expect(res.headers.get('RateLimit-Limit')).toBe('20')
    expect(res.headers.get('RateLimit-Remaining')).toBe('0')
    expect(res.headers.get('RateLimit-Reset')).toBe(
      `${Math.ceil(new Date('2026-07-25T12:01:00.000Z').getTime() / 1000)}`,
    )
  })

  it('still sets Cache-Control: no-store — the header map must MERGE, not replace', () => {
    const res = rateLimitExceededResponse(makeBlockedDecision())

    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Retry-After')).toBe('47')
  })

  it('names the bucket in the body without leaking the rate-limit key', async () => {
    const res = rateLimitExceededResponse(
      makeBlockedDecision({ bucket: 'holds:create' }),
    )
    const body = await res.json()

    expect(body).toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      retryable: true,
      uiAction: 'RETRY_LATER',
      message: 'Rate limit exceeded for holds:create.',
    })

    // The key carries a user id and an IP; it must never ride in the response.
    expect(JSON.stringify(body)).not.toContain('1.2.3.4')
    expect(JSON.stringify(body)).not.toContain('user_1')
  })
})
