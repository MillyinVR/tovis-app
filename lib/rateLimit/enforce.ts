// lib/rateLimit/enforce.ts

import { getRedis } from '@/lib/redis'

import {
  RATE_LIMITS,
  type RateLimitBucket,
  type RateLimitConfig,
} from './policies'

export type BlockedRateLimitDecision = Extract<
  RateLimitDecision,
  { allowed: false }
>

export type RateLimitDecision =
  | Readonly<{
      allowed: true
      bucket: RateLimitBucket
      key: string
      limit: number
      remaining: number
      resetAt: Date
      retryAfterSeconds: number
      source: 'redis' | 'memory' | 'fail-open'
    }>
  | Readonly<{
      allowed: false
      bucket: RateLimitBucket
      key: string
      limit: number
      remaining: 0
      resetAt: Date
      retryAfterSeconds: number
      source: 'redis' | 'memory'
      reason: 'rate_limited' | 'limiter_unavailable'
    }>

export type EnforceRateLimitInput = Readonly<{
  bucket: RateLimitBucket
  key: string
  now?: Date
}>

type WindowCounter = {
  count: number
  resetAtMs: number
}

const memoryCounters = new Map<string, WindowCounter>()

function cleanKeyPart(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    return 'unknown'
  }

  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9:_|.@-]/g, '_')
    .slice(0, 180)
}

function buildRateLimitKey(config: RateLimitConfig, key: string): string {
  return `${config.prefix}:${cleanKeyPart(key)}`
}

function getRetryAfterSeconds(resetAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000))
}

function getWindowResetAtMs(nowMs: number, windowSeconds: number): number {
  return nowMs + windowSeconds * 1000
}

function makeAllowedDecision(input: {
  bucket: RateLimitBucket
  key: string
  limit: number
  remaining: number
  resetAtMs: number
  nowMs: number
  source: 'redis' | 'memory' | 'fail-open'
}): RateLimitDecision {
  return {
    allowed: true,
    bucket: input.bucket,
    key: input.key,
    limit: input.limit,
    remaining: Math.max(0, input.remaining),
    resetAt: new Date(input.resetAtMs),
    retryAfterSeconds: getRetryAfterSeconds(input.resetAtMs, input.nowMs),
    source: input.source,
  }
}

function makeBlockedDecision(input: {
  bucket: RateLimitBucket
  key: string
  limit: number
  resetAtMs: number
  nowMs: number
  source: 'redis' | 'memory'
  reason?: 'rate_limited' | 'limiter_unavailable'
}): RateLimitDecision {
  return {
    allowed: false,
    bucket: input.bucket,
    key: input.key,
    limit: input.limit,
    remaining: 0,
    resetAt: new Date(input.resetAtMs),
    retryAfterSeconds: getRetryAfterSeconds(input.resetAtMs, input.nowMs),
    source: input.source,
    reason: input.reason ?? 'rate_limited',
  }
}

async function enforceWithRedis(input: {
  redisKey: string
  bucket: RateLimitBucket
  publicKey: string
  config: RateLimitConfig
  nowMs: number
}): Promise<RateLimitDecision> {
  const redis = getRedis()

  if (redis === null) {
    throw new Error('Redis is not configured for rate limiting.')
  }

  const count = await redis.incr(input.redisKey)

  if (count === 1) {
    await redis.expire(input.redisKey, input.config.windowSeconds)
  }

  const ttlSeconds = await redis.ttl(input.redisKey)
  const safeTtlSeconds =
    typeof ttlSeconds === 'number' && ttlSeconds > 0
      ? ttlSeconds
      : input.config.windowSeconds

  const resetAtMs = input.nowMs + safeTtlSeconds * 1000

  if (count > input.config.limit) {
    return makeBlockedDecision({
      bucket: input.bucket,
      key: input.publicKey,
      limit: input.config.limit,
      resetAtMs,
      nowMs: input.nowMs,
      source: 'redis',
    })
  }

  return makeAllowedDecision({
    bucket: input.bucket,
    key: input.publicKey,
    limit: input.config.limit,
    remaining: input.config.limit - count,
    resetAtMs,
    nowMs: input.nowMs,
    source: 'redis',
  })
}

function enforceWithMemory(input: {
  memoryKey: string
  bucket: RateLimitBucket
  publicKey: string
  config: RateLimitConfig
  nowMs: number
}): RateLimitDecision {
  const existing = memoryCounters.get(input.memoryKey)

  if (!existing || existing.resetAtMs <= input.nowMs) {
    const resetAtMs = getWindowResetAtMs(
      input.nowMs,
      input.config.windowSeconds,
    )

    memoryCounters.set(input.memoryKey, {
      count: 1,
      resetAtMs,
    })

    return makeAllowedDecision({
      bucket: input.bucket,
      key: input.publicKey,
      limit: input.config.limit,
      remaining: input.config.limit - 1,
      resetAtMs,
      nowMs: input.nowMs,
      source: 'memory',
    })
  }

  existing.count += 1

  if (existing.count > input.config.limit) {
    return makeBlockedDecision({
      bucket: input.bucket,
      key: input.publicKey,
      limit: input.config.limit,
      resetAtMs: existing.resetAtMs,
      nowMs: input.nowMs,
      source: 'memory',
    })
  }

  return makeAllowedDecision({
    bucket: input.bucket,
    key: input.publicKey,
    limit: input.config.limit,
    remaining: input.config.limit - existing.count,
    resetAtMs: existing.resetAtMs,
    nowMs: input.nowMs,
    source: 'memory',
  })
}

function pruneExpiredMemoryCounters(nowMs: number): void {
  for (const [key, counter] of memoryCounters.entries()) {
    if (counter.resetAtMs <= nowMs) {
      memoryCounters.delete(key)
    }
  }
}

export function clearInMemoryRateLimitCountersForTests(): void {
  memoryCounters.clear()
}

export function getRateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return {
    'RateLimit-Limit': `${decision.limit}`,
    'RateLimit-Remaining': `${decision.remaining}`,
    'RateLimit-Reset': `${Math.ceil(decision.resetAt.getTime() / 1000)}`,
    'Retry-After': `${decision.retryAfterSeconds}`,
  }
}

export async function enforceRateLimit({
  bucket,
  key,
  now = new Date(),
}: EnforceRateLimitInput): Promise<RateLimitDecision> {
  const config = RATE_LIMITS[bucket]
  const nowMs = now.getTime()
  const publicKey = cleanKeyPart(key)
  const redisKey = buildRateLimitKey(config, publicKey)

  try {
    return await enforceWithRedis({
      redisKey,
      bucket,
      publicKey,
      config,
      nowMs,
    })
  } catch {
    if (config.mode === 'auth-critical') {
      pruneExpiredMemoryCounters(nowMs)

      return enforceWithMemory({
        memoryKey: redisKey,
        bucket,
        publicKey,
        config,
        nowMs,
      })
    }

    const resetAtMs = getWindowResetAtMs(nowMs, config.windowSeconds)

    return makeAllowedDecision({
      bucket,
      key: publicKey,
      limit: config.limit,
      remaining: config.limit,
      resetAtMs,
      nowMs,
      source: 'fail-open',
    })
  }
}