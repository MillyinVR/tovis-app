// lib/rateLimitRedis.ts
import { redis } from '@/lib/redis'

type RateLimitArgs = {
  key: string
  limit: number
  windowSec: number
}

/**
 * Fixed-window counter:
 * - INCR key
 * - EXPIRE key windowSec (only when first created)
 */
export async function rateLimitRedis({ key, limit, windowSec }: RateLimitArgs) {
  if (!redis) {
    // Dev fallback: no Redis configured locally
    return { ok: true, remaining: limit, resetSec: windowSec }
  }

  const count = await redis.incr(key)

  if (count === 1) {
    // first hit creates the window
    await redis.expire(key, windowSec)
  }

  const ttl = await redis.ttl(key) // seconds
  const remaining = Math.max(0, limit - count)

  return {
    ok: count <= limit,
    remaining,
    resetSec: ttl > 0 ? ttl : windowSec,
    count,
  }
}
