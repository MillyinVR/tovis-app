// lib/rateLimitRedis.ts
import { requireRedis } from '@/lib/redis'

export type RateLimitArgs = {
  key: string
  limit: number
  windowSeconds: number
}

export type RateLimitResult = {
  success: boolean
  limit: number
  remaining: number
  resetMs: number
}

export async function rateLimitRedis(args: RateLimitArgs): Promise<RateLimitResult> {
  const redis = requireRedis()

  const { key, limit, windowSeconds } = args
  const now = Date.now()
  const windowMs = windowSeconds * 1000

  // Fixed-window counter
  const bucket = Math.floor(now / windowMs)
  const redisKey = `rl:${key}:${bucket}`

  const count = await redis.incr(redisKey)
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds)
  }

  const resetMs = (bucket + 1) * windowMs

  return {
    success: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetMs,
  }
}