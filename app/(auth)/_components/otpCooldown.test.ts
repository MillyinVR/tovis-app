import { describe, expect, it } from 'vitest'

import {
  RESEND_COOLDOWN_SECONDS,
  formatCooldown,
  readRetryAfterSeconds,
} from './otpCooldown'

describe('formatCooldown', () => {
  it('formats seconds as m:ss with zero-padded seconds', () => {
    expect(formatCooldown(0)).toBe('0:00')
    expect(formatCooldown(5)).toBe('0:05')
    expect(formatCooldown(59)).toBe('0:59')
    expect(formatCooldown(60)).toBe('1:00')
    expect(formatCooldown(75)).toBe('1:15')
    expect(formatCooldown(600)).toBe('10:00')
  })

  it('clamps negatives to 0:00 and rounds fractional seconds up', () => {
    expect(formatCooldown(-10)).toBe('0:00')
    expect(formatCooldown(4.2)).toBe('0:05')
  })
})

describe('readRetryAfterSeconds', () => {
  // Verbatim capture of a real 429 from `POST /api/v1/auth/phone-login/send`
  // (driven against a local dev server by tripping the auth:email:send bucket).
  // The previous tests asserted a TOP-LEVEL `retryAfterSeconds`, a shape no
  // route has ever emitted — so they stayed green while the countdown never
  // fired in production. Pin the real wire body instead.
  const REAL_RATE_LIMIT_BODY = {
    ok: false,
    error: 'Too many requests. Please slow down.',
    code: 'RATE_LIMITED',
    details: {
      bucket: 'auth:email:send',
      limit: 5,
      remaining: 0,
      reset: 1784241270333,
      retryAfterSeconds: 899,
      source: 'redis',
      reason: 'rate_limited',
    },
  }

  it('reads the hint from a real rate-limit response body', () => {
    expect(readRetryAfterSeconds(REAL_RATE_LIMIT_BODY)).toBe(899)
  })

  it('ignores a top-level hint — the API only ever nests it under details', () => {
    expect(readRetryAfterSeconds({ retryAfterSeconds: 30 })).toBeNull()
  })

  it('returns null when absent, empty, or unparseable', () => {
    expect(readRetryAfterSeconds(null)).toBeNull()
    expect(readRetryAfterSeconds({})).toBeNull()
    expect(readRetryAfterSeconds({ details: {} })).toBeNull()
    expect(readRetryAfterSeconds({ details: null })).toBeNull()
    expect(readRetryAfterSeconds({ details: 'nope' })).toBeNull()
    expect(readRetryAfterSeconds({ details: { retryAfterSeconds: 'abc' } })).toBeNull()
    expect(readRetryAfterSeconds({ details: { retryAfterSeconds: '' } })).toBeNull()
    expect(
      readRetryAfterSeconds({ details: { retryAfterSeconds: Number.NaN } }),
    ).toBeNull()
  })

  it('reads numeric values, rounding up and clamping to non-negative', () => {
    expect(readRetryAfterSeconds({ details: { retryAfterSeconds: 30 } })).toBe(30)
    expect(readRetryAfterSeconds({ details: { retryAfterSeconds: 30.2 } })).toBe(31)
    expect(readRetryAfterSeconds({ details: { retryAfterSeconds: -5 } })).toBe(0)
  })

  it('parses numeric strings', () => {
    expect(readRetryAfterSeconds({ details: { retryAfterSeconds: '45' } })).toBe(45)
    expect(readRetryAfterSeconds({ details: { retryAfterSeconds: '45.9' } })).toBe(46)
  })
})

describe('RESEND_COOLDOWN_SECONDS', () => {
  it('is the shared 60-second default', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60)
  })
})
