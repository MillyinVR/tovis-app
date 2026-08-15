// lib/health/redis.ts

import { randomUUID } from 'node:crypto'

import { getRedis } from '@/lib/redis'

import { errorMessageFromUnknown } from '@/lib/http'
import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  type HealthCheckResult,
} from './types'

const REDIS_CHECK_NAME = 'redis' as const
const REDIS_HEALTH_KEY_PREFIX = 'health:ready:redis'

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  })
}

async function pingRedis(): Promise<void> {
  const redis = getRedis()

  if (redis === null) {
    throw new Error(
      'Redis is not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL + KV_REST_API_TOKEN.',
    )
  }

  const key = `${REDIS_HEALTH_KEY_PREFIX}:${randomUUID()}`
  const value = `${Date.now()}:${randomUUID()}`

  await redis.set(key, value, { ex: 30 })

  const storedValue = await redis.get<string>(key)

  if (storedValue !== value) {
    throw new Error('Redis health check read-after-write verification failed.')
  }

  await redis.del(key)
}

export async function checkRedisHealth(
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<HealthCheckResult> {
  const startedAt = Date.now()

  try {
    await withTimeout(pingRedis(), timeoutMs, 'Redis health check')

    return {
      name: REDIS_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Redis is reachable.',
      details: {
        keyPrefix: REDIS_HEALTH_KEY_PREFIX,
        timeoutMs,
      },
    }
  } catch (error: unknown) {
    return {
      name: REDIS_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: errorMessageFromUnknown(error, 'Unknown Redis health check failure.'),
      details: {
        keyPrefix: REDIS_HEALTH_KEY_PREFIX,
        timeoutMs,
      },
    }
  }
}