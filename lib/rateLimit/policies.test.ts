// lib/rateLimit/policies.test.ts

import { describe, expect, it } from 'vitest'

import { RATE_LIMITS, type RateLimitBucket } from './policies'

const EXPECTED_LAUNCH_BUCKETS = [
  'holds:create',
  'bookings:finalize',
  'bookings:cancel',
  'bookings:reschedule',
  'consultation:decision',
  'consultation:decision:token',
  'client:rebook:token',
  'pro:bookings:write',
  'pro:media:write',
  'pro:offerings:write',
  'pro:locations:write',
  'pro:working-hours:write',
  'auth:login',
  'auth:login:identity',
  'auth:register',
  'auth:password-reset-request',
  'auth:password-reset-request:identity',
  'auth:password-reset-confirm',
  'auth:phone:verify',
  'auth:email:send',
  'auth:email:verify',
  'auth:sms-phone-hour',
  'auth:sms-phone-day',
] as const satisfies readonly RateLimitBucket[]

const AUTH_CRITICAL_BUCKETS = [
  'auth:login',
  'auth:login:identity',
  'auth:register',
  'auth:register:verified',
  'auth:password-reset-request',
  'auth:password-reset-request:identity',
  'auth:password-reset-confirm',
  'auth:phone:verify',
  'auth:email:send',
  'auth:email:verify',
  'auth:sms-phone-hour',
  'auth:sms-phone-day',
] as const satisfies readonly RateLimitBucket[]

function getBuckets(): RateLimitBucket[] {
  return Object.keys(RATE_LIMITS) as RateLimitBucket[]
}

describe('RATE_LIMITS', () => {
  it('defines every expected launch-critical bucket', () => {
    const buckets = new Set(getBuckets())

    for (const bucket of EXPECTED_LAUNCH_BUCKETS) {
      expect(buckets.has(bucket), `missing bucket: ${bucket}`).toBe(true)
    }
  })

  it('defines valid positive limits and windows for every bucket', () => {
    for (const [bucket, config] of Object.entries(RATE_LIMITS)) {
      expect(
        Number.isInteger(config.limit),
        `${bucket} limit must be an integer`,
      ).toBe(true)
      expect(config.limit, `${bucket} limit must be positive`).toBeGreaterThan(
        0,
      )

      expect(
        Number.isInteger(config.windowSeconds),
        `${bucket} windowSeconds must be an integer`,
      ).toBe(true)
      expect(
        config.windowSeconds,
        `${bucket} windowSeconds must be positive`,
      ).toBeGreaterThan(0)

      expect(
        config.prefix.trim().length,
        `${bucket} prefix must not be empty`,
      ).toBeGreaterThan(0)

      expect(
        config.prefix.startsWith('rl:'),
        `${bucket} prefix must start with rl:`,
      ).toBe(true)
    }
  })

  it('uses unique Redis prefixes for every bucket', () => {
    const prefixes = Object.values(RATE_LIMITS).map((config) => config.prefix)
    const uniquePrefixes = new Set(prefixes)

    expect(uniquePrefixes.size).toBe(prefixes.length)
  })

  it('uses only supported modes', () => {
    for (const [bucket, config] of Object.entries(RATE_LIMITS)) {
      expect(
        ['redis-only', 'auth-critical'].includes(config.mode),
        `${bucket} has unsupported mode: ${config.mode}`,
      ).toBe(true)
    }
  })

  it('limits auth-critical mode to auth and verification-sensitive buckets', () => {
    const allowedAuthCriticalBuckets = new Set<RateLimitBucket>(
      AUTH_CRITICAL_BUCKETS,
    )

    for (const bucket of getBuckets()) {
      const config = RATE_LIMITS[bucket]

      if (config.mode === 'auth-critical') {
        expect(
          allowedAuthCriticalBuckets.has(bucket),
          `${bucket} should not use auth-critical mode`,
        ).toBe(true)
      }
    }
  })

  it('keeps all auth-critical buckets in auth-critical mode', () => {
    for (const bucket of AUTH_CRITICAL_BUCKETS) {
      expect(RATE_LIMITS[bucket].mode, `${bucket} must be auth-critical`).toBe(
        'auth-critical',
      )
    }
  })

  it('keeps SMS phone limits stricter than general auth limits', () => {
    expect(RATE_LIMITS['auth:sms-phone-hour'].limit).toBeLessThanOrEqual(
      RATE_LIMITS['auth:login'].limit,
    )

    expect(RATE_LIMITS['auth:sms-phone-day'].limit).toBeLessThanOrEqual(
      RATE_LIMITS['auth:register:verified'].limit,
    )
  })

  it('keeps booking mutation buckets separate', () => {
    expect(RATE_LIMITS['bookings:finalize'].prefix).not.toBe(
      RATE_LIMITS['bookings:cancel'].prefix,
    )

    expect(RATE_LIMITS['bookings:cancel'].prefix).not.toBe(
      RATE_LIMITS['bookings:reschedule'].prefix,
    )

    expect(RATE_LIMITS['bookings:finalize'].prefix).not.toBe(
      RATE_LIMITS['bookings:reschedule'].prefix,
    )
  })

  it('keeps public token action buckets separate from authenticated consultation decisions', () => {
    expect(RATE_LIMITS['consultation:decision:token'].prefix).not.toBe(
      RATE_LIMITS['consultation:decision'].prefix,
    )

    expect(RATE_LIMITS['client:rebook:token'].prefix).not.toBe(
      RATE_LIMITS['consultation:decision:token'].prefix,
    )
  })
})