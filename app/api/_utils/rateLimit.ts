// app/api/_utils/rateLimit.ts
import { jsonFail } from './responses'
import { rateLimitRedis } from '@/lib/rateLimitRedis'
import { getTrustedClientIpFromNextHeaders } from '@/lib/trustedClientIp'
import { logAuthEvent } from '@/lib/observability/authEvents'
import {
  RATE_LIMITS,
  type RateLimitBucket,
  type RateLimitConfig,
} from '@/lib/rateLimit/policies'

type LocalBucketState = {
  tokens: number
  lastRefillMs: number
}

const localTokenBuckets = new Map<string, LocalBucketState>()

const REDIS_CIRCUIT_OPEN_MS = 30_000
let redisCircuitOpenUntilMs = 0

let hasLoggedNullRateLimitIdentity = false

function logNullRateLimitIdentityOnce() {
  if (hasLoggedNullRateLimitIdentity) return
  hasLoggedNullRateLimitIdentity = true

  logAuthEvent({
    level: 'error',
    event: 'rate_limit_identity_null',
    route: 'auth.rateLimit',
    message:
      'Trusted client IP resolved to null in production; using shared fallback bucket.',
    meta: {
      fallbackIdentityKind: 'ip',
      fallbackIdentityId: 'unknown',
      nodeEnv: process.env.NODE_ENV ?? null,
    },
  })
}

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
  | { kind: 'token'; id: string }

export function phoneRateLimitIdentity(phone: string): RateLimitIdentity {
  const normalized = phone.trim()
  if (!normalized) {
    throw new Error('phoneRateLimitIdentity requires a non-empty phone value.')
  }

  return { kind: 'phone', id: normalized }
}

/**
 * Identity for rate limiting by an opaque token-prefix. Used to cap
 * brute-force attempts against a single (partial) leaked token across
 * many IPs.
 */
export function tokenRateLimitIdentity(tokenPrefix: string): RateLimitIdentity {
  const normalized = tokenPrefix.trim()
  if (!normalized) {
    throw new Error('tokenRateLimitIdentity requires a non-empty token prefix.')
  }

  return { kind: 'token', id: normalized }
}

export async function rateLimitIdentity(
  userId?: string | null,
): Promise<RateLimitIdentity | null> {
  const u = typeof userId === 'string' ? userId.trim() : ''
  if (u) return { kind: 'user', id: u }

  const ip = await getTrustedClientIpFromNextHeaders()
  if (ip) return { kind: 'ip', id: ip }

  if (process.env.NODE_ENV === 'production') {
    logNullRateLimitIdentityOnce()
    return { kind: 'ip', id: 'unknown' }
  }

  return null
}

function buildIdentityEventFields(identity: RateLimitIdentity): {
  userId?: string
  phone?: string
  meta: Record<string, unknown>
} {
  if (identity.kind === 'user') {
    return {
      userId: identity.id,
      meta: { identityKind: identity.kind },
    }
  }

  if (identity.kind === 'phone') {
    return {
      phone: identity.id,
      meta: { identityKind: identity.kind },
    }
  }

  // 'ip' and 'token' kinds — log identity kind/id without leaking PII.
  return {
    meta: {
      identityKind: identity.kind,
      identityId: identity.id,
    },
  }
}

function logRateLimitDegraded(args: {
  event: 'auth.rate_limit.local_only_degraded' | 'auth.rate_limit.redis_skipped'
  bucket: RateLimitBucket
  config: RateLimitConfig
  identity: RateLimitIdentity
  keySuffix?: string
  circuitOpened?: boolean
}) {
  const identityFields = buildIdentityEventFields(args.identity)

  logAuthEvent({
    level: 'warn',
    event: args.event,
    route: 'auth.rateLimit',
    provider: 'redis',
    userId: identityFields.userId,
    phone: identityFields.phone,
    meta: {
      bucket: args.bucket,
      mode: args.config.mode,
      keySuffix: args.keySuffix ?? null,
      circuitOpened: args.circuitOpened ?? false,
      ...identityFields.meta,
    },
  })
}

export async function enforceRateLimit(args: {
  bucket: RateLimitBucket
  identity: RateLimitIdentity | null
  keySuffix?: string
}) {
  const { bucket, identity, keySuffix } = args
  if (!identity) return null

  const cfg = RATE_LIMITS[bucket]
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
    } catch {
      openRedisCircuit()
      logRateLimitDegraded({
        event: 'auth.rate_limit.local_only_degraded',
        bucket,
        config: cfg,
        identity,
        keySuffix,
        circuitOpened: true,
      })
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
  } catch {
    logRateLimitDegraded({
      event: 'auth.rate_limit.redis_skipped',
      bucket,
      config: cfg,
      identity,
      keySuffix,
      circuitOpened: false,
    })
    return null
  }
}