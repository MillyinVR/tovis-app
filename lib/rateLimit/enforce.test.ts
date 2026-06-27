// lib/rateLimit/enforce.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMock = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
}))

const redisModuleMock = vi.hoisted(() => ({
  getRedis: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  getRedis: redisModuleMock.getRedis,
}))

import {
  clearInMemoryRateLimitCountersForTests,
  enforceRateLimit,
  getRateLimitHeaders,
} from './enforce'

beforeEach(() => {
  vi.clearAllMocks()
  clearInMemoryRateLimitCountersForTests()

  redisMock.incr.mockResolvedValue(1)
  redisMock.expire.mockResolvedValue(1)
  redisMock.ttl.mockResolvedValue(60)

  redisModuleMock.getRedis.mockReturnValue(redisMock)
})

describe('enforceRateLimit', () => {
  it('allows a request when Redis count is within the bucket limit', async () => {
    redisMock.incr.mockResolvedValueOnce(1)
    redisMock.ttl.mockResolvedValueOnce(60)

    const decision = await enforceRateLimit({
      bucket: 'bookings:finalize',
      key: 'client_123',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(decision).toMatchObject({
      allowed: true,
      bucket: 'bookings:finalize',
      key: 'client_123',
      limit: 12,
      remaining: 11,
      source: 'redis',
    })

    expect(redisMock.incr).toHaveBeenCalledWith(
      'rl:bookings:finalize:client_123',
    )
    expect(redisMock.expire).toHaveBeenCalledWith(
      'rl:bookings:finalize:client_123',
      60,
    )
    expect(redisMock.ttl).toHaveBeenCalledWith(
      'rl:bookings:finalize:client_123',
    )
  })

  it('does not reset Redis expiry when the key already exists', async () => {
    redisMock.incr.mockResolvedValueOnce(2)
    redisMock.ttl.mockResolvedValueOnce(59)

    const decision = await enforceRateLimit({
      bucket: 'bookings:finalize',
      key: 'client_123',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(decision.allowed).toBe(true)
    expect(decision.source).toBe('redis')
    expect(decision.remaining).toBe(10)
    expect(redisMock.expire).not.toHaveBeenCalled()
  })

  it('blocks a request when Redis count exceeds the bucket limit', async () => {
    redisMock.incr.mockResolvedValueOnce(13)
    redisMock.ttl.mockResolvedValueOnce(42)

    const decision = await enforceRateLimit({
      bucket: 'bookings:finalize',
      key: 'client_123',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(decision).toMatchObject({
      allowed: false,
      bucket: 'bookings:finalize',
      key: 'client_123',
      limit: 12,
      remaining: 0,
      source: 'redis',
      reason: 'rate_limited',
    })

    expect(decision.retryAfterSeconds).toBe(42)
    expect(decision.resetAt.toISOString()).toBe('2026-05-15T12:00:42.000Z')
  })

  it('falls open for redis-only buckets when Redis is unavailable', async () => {
    redisModuleMock.getRedis.mockReturnValueOnce(null)

    const decision = await enforceRateLimit({
      bucket: 'bookings:finalize',
      key: 'client_123',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(decision).toMatchObject({
      allowed: true,
      bucket: 'bookings:finalize',
      key: 'client_123',
      limit: 12,
      remaining: 12,
      source: 'fail-open',
    })

    expect(decision.resetAt.toISOString()).toBe('2026-05-15T12:01:00.000Z')
  })

  it('uses bounded memory fallback for auth-critical buckets when Redis is unavailable', async () => {
    redisModuleMock.getRedis.mockReturnValue(null)

    const now = new Date('2026-05-15T12:00:00.000Z')

    for (let index = 0; index < 10; index += 1) {
      const decision = await enforceRateLimit({
        bucket: 'auth:password-reset-confirm',
        key: 'ip_123',
        now,
      })

      expect(decision.allowed).toBe(true)
      expect(decision.source).toBe('memory')
      expect(decision.limit).toBe(10)
      expect(decision.remaining).toBe(9 - index)
    }

    const blocked = await enforceRateLimit({
      bucket: 'auth:password-reset-confirm',
      key: 'ip_123',
      now,
    })

    expect(blocked).toMatchObject({
      allowed: false,
      bucket: 'auth:password-reset-confirm',
      key: 'ip_123',
      limit: 10,
      remaining: 0,
      source: 'memory',
      reason: 'rate_limited',
    })
  })

  it('resets the memory fallback after the configured window', async () => {
    redisModuleMock.getRedis.mockReturnValue(null)

    const firstWindow = new Date('2026-05-15T12:00:00.000Z')

    for (let index = 0; index < 10; index += 1) {
      await enforceRateLimit({
        bucket: 'auth:password-reset-confirm',
        key: 'ip_123',
        now: firstWindow,
      })
    }

    const blocked = await enforceRateLimit({
      bucket: 'auth:password-reset-confirm',
      key: 'ip_123',
      now: firstWindow,
    })

    expect(blocked.allowed).toBe(false)

    const nextWindow = new Date('2026-05-15T12:15:01.000Z')

    const allowedAgain = await enforceRateLimit({
      bucket: 'auth:password-reset-confirm',
      key: 'ip_123',
      now: nextWindow,
    })

    expect(allowedAgain).toMatchObject({
      allowed: true,
      source: 'memory',
      remaining: 9,
    })
  })

  it('uses separate counters per bucket and key in memory fallback', async () => {
    redisModuleMock.getRedis.mockReturnValue(null)

    const now = new Date('2026-05-15T12:00:00.000Z')

    const first = await enforceRateLimit({
      bucket: 'auth:password-reset-confirm',
      key: 'ip_123',
      now,
    })

    const second = await enforceRateLimit({
      bucket: 'auth:password-reset-request',
      key: 'ip_123',
      now,
    })

    const third = await enforceRateLimit({
      bucket: 'auth:password-reset-confirm',
      key: 'ip_456',
      now,
    })

    expect(first).toMatchObject({
      allowed: true,
      bucket: 'auth:password-reset-confirm',
      remaining: 9,
      source: 'memory',
    })

    expect(second).toMatchObject({
      allowed: true,
      bucket: 'auth:password-reset-request',
      remaining: 19,
      source: 'memory',
    })

    expect(third).toMatchObject({
      allowed: true,
      bucket: 'auth:password-reset-confirm',
      remaining: 9,
      source: 'memory',
    })
  })

  it('sanitizes unsafe key characters before using Redis', async () => {
    redisMock.incr.mockResolvedValueOnce(1)
    redisMock.ttl.mockResolvedValueOnce(60)

    const decision = await enforceRateLimit({
      bucket: 'auth:email:send',
      key: '  User+Email@Example.COM / weird?key=true  ',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(decision).toMatchObject({
      allowed: true,
      bucket: 'auth:email:send',
      key: 'user_email@example.com___weird_key_true',
      source: 'redis',
    })

    expect(redisMock.incr).toHaveBeenCalledWith(
      'rl:auth:email:send:user_email@example.com___weird_key_true',
    )
  })

  it('uses unknown for blank keys', async () => {
    redisMock.incr.mockResolvedValueOnce(1)
    redisMock.ttl.mockResolvedValueOnce(60)

    const decision = await enforceRateLimit({
      bucket: 'auth:email:send',
      key: '   ',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(decision).toMatchObject({
      allowed: true,
      key: 'unknown',
      source: 'redis',
    })

    expect(redisMock.incr).toHaveBeenCalledWith(
      'rl:auth:email:send:unknown',
    )
  })

  it('uses the configured window when Redis returns a missing or invalid ttl', async () => {
    redisMock.incr.mockResolvedValueOnce(1)
    redisMock.ttl.mockResolvedValueOnce(-1)

    const decision = await enforceRateLimit({
      bucket: 'bookings:reschedule',
      key: 'client_123',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(decision.allowed).toBe(true)
    expect(decision.resetAt.toISOString()).toBe('2026-05-15T12:05:00.000Z')
    expect(decision.retryAfterSeconds).toBe(300)
  })
})

describe('getRateLimitHeaders', () => {
  it('returns standard rate limit headers for allowed decisions', async () => {
    redisMock.incr.mockResolvedValueOnce(3)
    redisMock.ttl.mockResolvedValueOnce(45)

    const decision = await enforceRateLimit({
      bucket: 'bookings:finalize',
      key: 'client_123',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(getRateLimitHeaders(decision)).toEqual({
      'RateLimit-Limit': '12',
      'RateLimit-Remaining': '9',
      'RateLimit-Reset': `${Math.ceil(
        new Date('2026-05-15T12:00:45.000Z').getTime() / 1000,
      )}`,
      'Retry-After': '45',
    })
  })

  it('returns standard rate limit headers for blocked decisions', async () => {
    redisMock.incr.mockResolvedValueOnce(13)
    redisMock.ttl.mockResolvedValueOnce(30)

    const decision = await enforceRateLimit({
      bucket: 'bookings:finalize',
      key: 'client_123',
      now: new Date('2026-05-15T12:00:00.000Z'),
    })

    expect(getRateLimitHeaders(decision)).toEqual({
      'RateLimit-Limit': '12',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': `${Math.ceil(
        new Date('2026-05-15T12:00:30.000Z').getTime() / 1000,
      )}`,
      'Retry-After': '30',
    })
  })
})