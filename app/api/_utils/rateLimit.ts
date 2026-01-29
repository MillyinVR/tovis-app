// app/api/_utils/rateLimit.ts
import { headers } from 'next/headers'
import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import { jsonFail } from './responses'

export type RateLimitBucket =
  | 'holds:create'
  | 'bookings:reschedule'
  | 'looks:like'
  | 'looks:comment'
  | 'consultation:decision'
  | 'google:proxy'
  | 'messages:send'

type LimitConfig = {
  tokens: number
  window: `${number} s` | `${number} m` | `${number} h` | `${number} d`
  prefix: string
}

const LIMITS: Record<RateLimitBucket, LimitConfig> = {
  'holds:create': { tokens: 12, window: '1 m', prefix: 'rl:holds:create' },
  'bookings:reschedule': { tokens: 8, window: '5 m', prefix: 'rl:bookings:reschedule' },
  'looks:like': { tokens: 60, window: '1 m', prefix: 'rl:looks:like' },
  'looks:comment': { tokens: 12, window: '1 m', prefix: 'rl:looks:comment' },
  'consultation:decision': { tokens: 8, window: '5 m', prefix: 'rl:consultation:decision' },
  'google:proxy': { tokens: 60, window: '1 m', prefix: 'rl:google:proxy' },
  'messages:send': { tokens: 18, window: '1 m', prefix: 'rl:messages:send' },
}

const redis = Redis.fromEnv()

async function getClientIpFromHeaders(): Promise<string | null> {
  const h = await headers()

  // Standard on Vercel / proxies
  const xff = h.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    return first || null
  }

  // Some setups set this
  const rip = h.get('x-real-ip')
  if (rip) return rip.trim() || null

  return null
}

export type RateLimitIdentity = { kind: 'user'; id: string } | { kind: 'ip'; id: string }

export async function rateLimitIdentity(userId?: string | null): Promise<RateLimitIdentity | null> {
  const u = typeof userId === 'string' ? userId.trim() : ''
  if (u) return { kind: 'user', id: u }

  const ip = await getClientIpFromHeaders()
  return ip ? { kind: 'ip', id: ip } : null
}

// Tiny runtime cache so we don’t re-create Ratelimit objects constantly
const limiterCache = new Map<RateLimitBucket, Ratelimit>()

function getLimiter(bucket: RateLimitBucket) {
  const hit = limiterCache.get(bucket)
  if (hit) return hit

  const cfg = LIMITS[bucket]
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.tokens, cfg.window),
    prefix: cfg.prefix,
    analytics: true,
  })

  limiterCache.set(bucket, limiter)
  return limiter
}

export async function enforceRateLimit(args: {
  bucket: RateLimitBucket
  identity: RateLimitIdentity | null
  keySuffix?: string
}) {
  const { bucket, identity, keySuffix } = args
  if (!identity) return null

  const limiter = getLimiter(bucket)
  const key = `${identity.kind}:${identity.id}${keySuffix ? `:${keySuffix}` : ''}`

  const result = await limiter.limit(key)

  if (result.success) return null

  // result.reset is a unix ms timestamp
  const retryAfterSec = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))

  return jsonFail(
    429,
    'Too many requests. Please slow down.',
    {
      code: 'RATE_LIMITED',
      details: {
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      },
    },
    {
      headers: {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(result.reset),
        'Retry-After': String(retryAfterSec),
      },
    },
  )
}
