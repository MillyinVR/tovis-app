// lib/redis.ts
import { Redis } from '@upstash/redis'

function readUpstashRestEnv(): { url: string; token: string } | null {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (upstashUrl && upstashToken) return { url: upstashUrl, token: upstashToken }

  // Vercel KV compatibility (if you’re using KV env names)
  const kvUrl = process.env.KV_REST_API_URL?.trim()
  const kvToken = process.env.KV_REST_API_TOKEN?.trim()
  if (kvUrl && kvToken) return { url: kvUrl, token: kvToken }

  return null
}

let _redis: Redis | null | undefined

export function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis

  const cfg = readUpstashRestEnv()
  if (!cfg) {
    _redis = null
    return _redis
  }

  _redis = new Redis({ url: cfg.url, token: cfg.token })
  return _redis
}

export function requireRedis(): Redis {
  const r = getRedis()
  if (!r) {
    throw new Error(
      'Redis is not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN).',
    )
  }
  return r
}