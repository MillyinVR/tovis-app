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
  it('returns null when absent, empty, or unparseable', () => {
    expect(readRetryAfterSeconds(null)).toBeNull()
    expect(readRetryAfterSeconds({})).toBeNull()
    expect(readRetryAfterSeconds({ retryAfterSeconds: 'abc' })).toBeNull()
    expect(readRetryAfterSeconds({ retryAfterSeconds: '' })).toBeNull()
    expect(readRetryAfterSeconds({ retryAfterSeconds: Number.NaN })).toBeNull()
  })

  it('reads numeric values, rounding up and clamping to non-negative', () => {
    expect(readRetryAfterSeconds({ retryAfterSeconds: 30 })).toBe(30)
    expect(readRetryAfterSeconds({ retryAfterSeconds: 30.2 })).toBe(31)
    expect(readRetryAfterSeconds({ retryAfterSeconds: -5 })).toBe(0)
  })

  it('parses numeric strings', () => {
    expect(readRetryAfterSeconds({ retryAfterSeconds: '45' })).toBe(45)
    expect(readRetryAfterSeconds({ retryAfterSeconds: '45.9' })).toBe(46)
  })
})

describe('RESEND_COOLDOWN_SECONDS', () => {
  it('is the shared 60-second default', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60)
  })
})
