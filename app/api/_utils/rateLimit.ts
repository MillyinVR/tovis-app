// app/api/_utils/rateLimit.ts

import { createHash } from 'node:crypto'

import type { NextResponse } from 'next/server'

import { jsonFail } from './responses'

import {
  enforceRateLimit as enforceRateLimitDecision,
  getRateLimitHeaders,
  type BlockedRateLimitDecision,
} from '@/lib/rateLimit/enforce'
import { type RateLimitBucket } from '@/lib/rateLimit/policies'
import { logAuthEvent } from '@/lib/observability/authEvents'
import { getTrustedClientIpFromNextHeaders } from '@/lib/trustedClientIp'

export type RateLimitIdentity =
  | { kind: 'user'; id: string }
  | { kind: 'ip'; id: string }
  | { kind: 'phone'; id: string }
  | { kind: 'token'; id: string }

let hasLoggedNullRateLimitIdentity = false

function logNullRateLimitIdentityOnce(): void {
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

function normalizeIdentityPart(value: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error('Rate limit identity value must be non-empty.')
  }

  return normalized
}

function buildIdentityKey(
  identity: RateLimitIdentity,
  keySuffix?: string,
): string {
  const base = `${identity.kind}:${normalizeIdentityPart(identity.id)}`

  if (!keySuffix?.trim()) {
    return base
  }

  return `${base}:${keySuffix.trim()}`
}

function buildRateLimitResponse(decision: BlockedRateLimitDecision) {
  return jsonFail(
    429,
    'Too many requests. Please slow down.',
    {
      code: 'RATE_LIMITED',
      details: {
        bucket: decision.bucket,
        limit: decision.limit,
        remaining: decision.remaining,
        reset: decision.resetAt.getTime(),
        retryAfterSeconds: decision.retryAfterSeconds,
        source: decision.source,
        reason: decision.reason,
      },
    },
    {
      headers: {
        ...getRateLimitHeaders(decision),
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': String(decision.remaining),
        'X-RateLimit-Reset': String(decision.resetAt.getTime()),
      },
    },
  )
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

  return {
    meta: {
      identityKind: identity.kind,
      identityId: identity.id,
    },
  }
}

function logRateLimitDecision(args: {
  bucket: RateLimitBucket
  identity: RateLimitIdentity
  keySuffix?: string
  source: 'fail-open' | 'memory'
  event:
    | 'auth.rate_limit.local_only_degraded'
    | 'auth.rate_limit.redis_skipped'
}): void {
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
      keySuffix: args.keySuffix ?? null,
      source: args.source,
      ...identityFields.meta,
    },
  })
}

/**
 * Build a rate-limit `keySuffix` from an email, for composing a per-account
 * dimension onto an IP-keyed bucket (e.g. `auth:login:identity`). The email is
 * hashed so raw PII never lands in a Redis key or in rate-limit log lines; the
 * caller is responsible for passing an already-normalized (lowercased) email so
 * the hash is stable across attempts.
 */
export function emailRateLimitKeySuffix(normalizedEmail: string): string {
  return createHash('sha256')
    .update(normalizeIdentityPart(normalizedEmail))
    .digest('hex')
    .slice(0, 32)
}

export function phoneRateLimitIdentity(phone: string): RateLimitIdentity {
  return {
    kind: 'phone',
    id: normalizeIdentityPart(phone),
  }
}

/**
 * Identity for rate limiting by an opaque token-prefix. Used to cap
 * brute-force attempts against a single partial leaked token across many IPs.
 */
export function tokenRateLimitIdentity(tokenPrefix: string): RateLimitIdentity {
  return {
    kind: 'token',
    id: normalizeIdentityPart(tokenPrefix),
  }
}

export async function rateLimitIdentity(
  userId?: string | null,
): Promise<RateLimitIdentity | null> {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''

  if (normalizedUserId) {
    return { kind: 'user', id: normalizedUserId }
  }

  const ip = await getTrustedClientIpFromNextHeaders()

  if (ip) {
    return { kind: 'ip', id: ip }
  }

  if (process.env.NODE_ENV === 'production') {
    logNullRateLimitIdentityOnce()
    return { kind: 'ip', id: 'unknown' }
  }

  return null
}

export async function enforceRateLimit(args: {
  bucket: RateLimitBucket
  identity: RateLimitIdentity | null
  keySuffix?: string
}): Promise<NextResponse | null> {
  const { bucket, identity, keySuffix } = args

  if (identity === null) {
    return null
  }

  const decision = await enforceRateLimitDecision({
    bucket,
    key: buildIdentityKey(identity, keySuffix),
  })

  if (decision.allowed) {
    if (decision.source === 'fail-open') {
      logRateLimitDecision({
        event: 'auth.rate_limit.redis_skipped',
        bucket,
        identity,
        keySuffix,
        source: 'fail-open',
      })
    }

    return null
  }

  return buildRateLimitResponse(decision)
}