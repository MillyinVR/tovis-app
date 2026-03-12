// app/api/_utils/rateLimit.ts
import { headers } from 'next/headers'
import { jsonFail } from './responses'
import { rateLimitRedis } from '@/lib/rateLimitRedis'

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
  | 'auth:password-reset-request'
  | 'auth:password-reset-confirm'

type LimitConfig = {
  limit: number
  windowSeconds: number
  prefix: string
}

const LIMITS: Record<RateLimitBucket, LimitConfig> = {
  'holds:create': { limit: 12, windowSeconds: 60, prefix: 'rl:holds:create' },
  'bookings:reschedule': { limit: 8, windowSeconds: 5 * 60, prefix: 'rl:bookings:reschedule' },
  'looks:like': { limit: 60, windowSeconds: 60, prefix: 'rl:looks:like' },
  'looks:comment': { limit: 12, windowSeconds: 60, prefix: 'rl:looks:comment' },
  'consultation:decision': { limit: 8, windowSeconds: 5 * 60, prefix: 'rl:consultation:decision' },
  'google:proxy': { limit: 60, windowSeconds: 60, prefix: 'rl:google:proxy' },
  'messages:send': { limit: 18, windowSeconds: 60, prefix: 'rl:messages:send' },
  'messages:read': { limit: 120, windowSeconds: 60, prefix: 'rl:messages:read' },
  // Auth endpoints: IP-based, stricter limits to prevent brute force
  'auth:login': { limit: 10, windowSeconds: 15 * 60, prefix: 'rl:auth:login' },
  'auth:register': { limit: 5, windowSeconds: 60 * 60, prefix: 'rl:auth:register' },
  'auth:password-reset-request': { limit: 5, windowSeconds: 15 * 60, prefix: 'rl:auth:pw-reset-req' },
  'auth:password-reset-confirm': { limit: 10, windowSeconds: 15 * 60, prefix: 'rl:auth:pw-reset-confirm' },
}

async function getClientIpFromHeaders(): Promise<string | null> {
  const h = await headers()

  const xff = h.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    return first || null
  }

  const rip = h.get('x-real-ip')
  if (rip) return rip.trim() || null

  return null
}

export type RateLimitIdentity =
  | { kind: 'user'; id: string }
  | { kind: 'ip'; id: string }

export async function rateLimitIdentity(userId?: string | null): Promise<RateLimitIdentity | null> {
  const u = typeof userId === 'string' ? userId.trim() : ''
  if (u) return { kind: 'user', id: u }

  const ip = await getClientIpFromHeaders()
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

  // One key per bucket + identity (+ optional suffix)
  const key = `${cfg.prefix}:${identity.kind}:${identity.id}${keySuffix ? `:${keySuffix}` : ''}`

  try {
    const result = await rateLimitRedis({
      key,
      limit: cfg.limit,
      windowSeconds: cfg.windowSeconds,
    })

    if (result.success) return null

    const retryAfterSec = Math.max(1, Math.ceil((result.resetMs - Date.now()) / 1000))

    return jsonFail(
      429,
      'Too many requests. Please slow down.',
      {
        code: 'RATE_LIMITED',
        details: {
          limit: result.limit,
          remaining: result.remaining,
          reset: result.resetMs,
        },
      },
      {
        headers: {
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(result.resetMs),
          'Retry-After': String(retryAfterSec),
        },
      },
    )
  } catch (e) {
    // Fail-open: if Redis is missing/down, don't take your API down.
    console.warn('Rate limit skipped (redis error):', e)
    return null
  }
}