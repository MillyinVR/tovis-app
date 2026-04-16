// app/api/_utils/rateLimit.ts
import { jsonFail } from './responses'
import { rateLimitRedis } from '@/lib/rateLimitRedis'
import { getTrustedClientIpFromNextHeaders } from '@/lib/trustedClientIp'

export type RateLimitBucket =
  | 'holds:create'
  | 'bookings:reschedule'
  | 'looks:like'
  | 'looks:comment'
  | 'consultation:decision'
  | 'google:proxy'
  | 'messages:send'
  | 'messages:read'
  | 'auth:login'
  | 'auth:register'
  | 'auth:register:verified'
  | 'auth:password-reset-request'
  | 'auth:password-reset-confirm'
  | 'auth:sms-phone-hour'
  | 'auth:sms-phone-day'

type LimitMode = 'redis-only' | 'auth-critical'

type LimitConfig = {
  limit: number
  windowSeconds: number
  prefix: string
  mode: LimitMode
}

const LIMITS: Record<RateLimitBucket, LimitConfig> = {
  'holds:create': {
    limit: 12,
    windowSeconds: 60,
    prefix: 'rl:holds:create',
    mode: 'redis-only',
  },
  'bookings:reschedule': {
    limit: 8,
    windowSeconds: 5 * 60,
    prefix: 'rl:bookings:reschedule',
    mode: 'redis-only',
  },
  'looks:like': {
    limit: 60,
    windowSeconds: 60,
    prefix: 'rl:looks:like',
    mode: 'redis-only',
  },
  'looks:comment': {
    limit: 12,
    windowSeconds: 60,
    prefix: 'rl:looks:comment',
    mode: 'redis-only',
  },
  'consultation:decision': {
    limit: 8,
    windowSeconds: 5 * 60,
    prefix: 'rl:consultation:decision',
    mode: 'redis-only',
  },
  'google:proxy': {
    limit: 60,
    windowSeconds: 60,
    prefix: 'rl:google:proxy',
    mode: 'redis-only',
  },
  'messages:send': {
    limit: 18,
    windowSeconds: 60,
    prefix: 'rl:messages:send',
    mode: 'redis-only',
  },
  'messages:read': {
    limit: 120,
    windowSeconds: 60,
    prefix: 'rl:messages:read',
    mode: 'redis-only',
  },

  // Auth-critical buckets: bounded locally if Redis fails.
  'auth:login': {
    limit: 10,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:login',
    mode: 'auth-critical',
  },
  'auth:register': {
    limit: 5,
    windowSeconds: 60 * 60,
    prefix: 'rl:auth:register',
    mode: 'auth-critical',
  },
  'auth:register:verified': {
    limit: 12,
    windowSeconds: 60 * 60,
    prefix: 'rl:auth:register:verified',
    mode: 'auth-critical',
  },
  'auth:password-reset-request': {
    limit: 5,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:pw-reset-req',
    mode: 'auth-critical',
  },
  'auth:password-reset-confirm': {
    limit: 10,
    windowSeconds: 15 * 60,
    prefix: 'rl:auth:pw-reset-confirm',
    mode: 'auth-critical',
  },
  'auth:sms-phone-hour': {
    limit: 3,
    windowSeconds: 60 * 60,
    prefix: 'rl:auth:sms:phone:hour',
    mode: 'auth-critical',
  },
  'auth:sms-phone-day': {
    limit: 6,
    windowSeconds: 24 * 60 * 60,
    prefix: 'rl:auth:sms:phone:day',
    mode: 'auth-critical',
  },
}

type LocalBucketState = {
  tokens: number
  lastRefillMs: number
}

const localTokenBuckets = new Map<string, LocalBucketState>()

const REDIS_CIRCUIT_OPEN_MS = 30_000
let redisCircuitOpenUntilMs = 0

function isRedisCircuitOpen(nowMs = Date.now()): boolean {
  return nowMs < redisCircuitOpenUntilMs
}

function openRedisCircuit(nowMs = Date.now()) {
  redisCircuitOpenUntilMs = Math.max(
    redisCircuitOpenUntilMs,
    nowMs + REDIS_CIRCUIT_OPEN_MS,
  )
}

function consumeLocalTokenBucket(args: {
  key: string
  limit: number
  windowSeconds: number
  nowMs?: number
}): {
  allowed: boolean
  remaining: number
  resetMs: number
} {
  const { key, limit, windowSeconds } = args
  const nowMs = args.nowMs ?? Date.now()

  const refillRatePerMs = limit / (windowSeconds * 1000)
  const existing = localTokenBuckets.get(key)

  let tokens = limit
  let lastRefillMs = nowMs

  if (existing) {
    const elapsedMs = Math.max(0, nowMs - existing.lastRefillMs)
    tokens = Math.min(limit, existing.tokens + elapsedMs * refillRatePerMs)
    lastRefillMs = nowMs
  }

  if (tokens >= 1) {
    const nextTokens = tokens - 1
    localTokenBuckets.set(key, {
      tokens: nextTokens,
      lastRefillMs,
    })

    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(nextTokens)),
      resetMs: nowMs,
    }
  }

  const msUntilNextToken =
    refillRatePerMs > 0
      ? Math.ceil((1 - tokens) / refillRatePerMs)
      : windowSeconds * 1000

  localTokenBuckets.set(key, {
    tokens,
    lastRefillMs,
  })

  return {
    allowed: false,
    remaining: 0,
    resetMs: nowMs + Math.max(1, msUntilNextToken),
  }
}

function buildRateLimitResponse(args: {
  limit: number
  remaining: number
  resetMs: number
}) {
  const retryAfterSec = Math.max(
    1,
    Math.ceil((args.resetMs - Date.now()) / 1000),
  )

  return jsonFail(
    429,
    'Too many requests. Please slow down.',
    {
      code: 'RATE_LIMITED',
      details: {
        limit: args.limit,
        remaining: args.remaining,
        reset: args.resetMs,
      },
    },
    {
      headers: {
        'X-RateLimit-Limit': String(args.limit),
        'X-RateLimit-Remaining': String(args.remaining),
        'X-RateLimit-Reset': String(args.resetMs),
        'Retry-After': String(retryAfterSec),
      },
    },
  )
}

export type RateLimitIdentity =
  | { kind: 'user'; id: string }
  | { kind: 'ip'; id: string }
  | { kind: 'phone'; id: string }

export function phoneRateLimitIdentity(phone: string): RateLimitIdentity {
  const normalized = phone.trim()
  if (!normalized) {
    throw new Error('phoneRateLimitIdentity requires a non-empty phone value.')
  }

  return { kind: 'phone', id: normalized }
}

export async function rateLimitIdentity(
  userId?: string | null,
): Promise<RateLimitIdentity | null> {
  const u = typeof userId === 'string' ? userId.trim() : ''
  if (u) return { kind: 'user', id: u }

  const ip = await getTrustedClientIpFromNextHeaders()
  return ip ? { kind: 'ip', id: ip } : null
}

export async function enforceRateLimit(args: {
  bucket: RateLimitBucket
  identity: RateLimitIdentity | null
  keySuffix?: string
}) {
  const { bucket, identity, keySuffix } = args
  if (!identity) return null

  const cfg = LIMITS[bucket]
  const key = `${cfg.prefix}:${identity.kind}:${identity.id}${
    keySuffix ? `:${keySuffix}` : ''
  }`

  if (cfg.mode === 'auth-critical') {
    const local = consumeLocalTokenBucket({
      key,
      limit: cfg.limit,
      windowSeconds: cfg.windowSeconds,
    })

    if (!local.allowed) {
      return buildRateLimitResponse({
        limit: cfg.limit,
        remaining: local.remaining,
        resetMs: local.resetMs,
      })
    }

    if (isRedisCircuitOpen()) {
      return null
    }

    try {
      const result = await rateLimitRedis({
        key,
        limit: cfg.limit,
        windowSeconds: cfg.windowSeconds,
      })

      if (result.success) return null

      return buildRateLimitResponse({
        limit: result.limit,
        remaining: result.remaining,
        resetMs: result.resetMs,
      })
    } catch (e) {
      openRedisCircuit()
      console.warn('Rate limit degraded to local-only mode (redis error):', e)
      return null
    }
  }

  try {
    const result = await rateLimitRedis({
      key,
      limit: cfg.limit,
      windowSeconds: cfg.windowSeconds,
    })

    if (result.success) return null

    return buildRateLimitResponse({
      limit: result.limit,
      remaining: result.remaining,
      resetMs: result.resetMs,
    })
  } catch (e) {
    console.warn('Rate limit skipped (redis error):', e)
    return null
  }
}