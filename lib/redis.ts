// lib/redis.ts
import { Redis } from '@upstash/redis'

function pickEnv(name: string) {
  const v = process.env[name]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function buildRedis() {
  // Prefer the “native” Upstash envs
  const upstashUrl = pickEnv('UPSTASH_REDIS_REST_URL')
  const upstashToken = pickEnv('UPSTASH_REDIS_REST_TOKEN')

  if (upstashUrl && upstashToken) {
    return new Redis({ url: upstashUrl, token: upstashToken })
  }

  // Vercel integration can expose KV_* envs
  const kvUrl = pickEnv('KV_REST_API_URL')
  const kvToken = pickEnv('KV_REST_API_TOKEN')

  if (kvUrl && kvToken) {
    return new Redis({ url: kvUrl, token: kvToken })
  }

  // Fail loudly in prod, gently in dev
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Redis env vars missing. Expected UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN.',
    )
  }

  return null
}

export const redis = buildRedis()

export function hasRedis() {
  return Boolean(redis)
}
