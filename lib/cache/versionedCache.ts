// lib/cache/versionedCache.ts
//
// Redis-backed cache for hot read paths. Cache keys embed a version
// number so a write that bumps the version (via
// `bumpScheduleConfigVersion` from `lib/booking/cacheVersion.ts`)
// instantly invalidates every cached entry under that scope+scopeId
// without a separate purge step. Old entries age out via the TTL
// backstop.
//
// Pattern at the call site:
//
//   const version = await getScheduleConfigVersion(professionalId)
//   const { value, cacheHit } = await withVersionedCache(
//     {
//       scope: 'availability:bootstrap',
//       scopeId: professionalId,
//       version,
//       extra: `${date}:${mode}`,
//     },
//     () => loadAvailabilityBootstrap({ professionalId, date, mode }),
//   )
//
// Best-effort by design: if Redis is unreachable the loader runs every
// time. The cache is a performance optimization, not a correctness
// boundary.

import { getRedis } from '@/lib/redis'

export type VersionedCacheKey = {
  /** Stable identifier for the read shape, e.g. 'availability:bootstrap'. */
  scope: string
  /** The entity the read belongs to, e.g. a `professionalId`. */
  scopeId: string
  /**
   * Monotonic version number. Typically `scheduleConfigVersion` for
   * pro-scoped reads; can be any integer the writer bumps on mutation.
   */
  version: number
  /**
   * Optional extra discriminators (date, mode, locale). Joined into the
   * cache key with `:` separators.
   */
  extra?: string | null
}

const DEFAULT_TTL_SECONDS = 5 * 60 // 5 minutes
const KEY_PREFIX = 'vc'

function buildKey(key: VersionedCacheKey): string {
  const extra = key.extra ? `:${key.extra}` : ''
  return `${KEY_PREFIX}:${key.scope}:${key.scopeId}:v${key.version}${extra}`
}

function logCacheError(args: {
  action: 'get' | 'set'
  key: VersionedCacheKey
  error: unknown
}): void {
  console.error('versioned cache error', {
    route: 'lib/cache/versionedCache.ts',
    action: args.action,
    scope: args.key.scope,
    scopeId: args.key.scopeId,
    version: args.key.version,
    error:
      args.error instanceof Error
        ? { name: args.error.name, message: args.error.message }
        : args.error,
  })
}

/**
 * Read a cached value. Returns `null` on miss, on Redis error, or when
 * Redis is not configured.
 */
export async function getCached<T>(
  key: VersionedCacheKey,
): Promise<T | null> {
  const redis = getRedis()
  if (!redis) return null

  try {
    const raw = await redis.get<T>(buildKey(key))
    return (raw as T | null) ?? null
  } catch (error: unknown) {
    logCacheError({ action: 'get', key, error })
    return null
  }
}

/**
 * Write a value to the cache. No-op when Redis is not configured;
 * errors are swallowed so a Redis outage never breaks the caller.
 */
export async function setCached<T>(
  key: VersionedCacheKey,
  value: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  try {
    await redis.set(buildKey(key), value, { ex: ttlSeconds })
  } catch (error: unknown) {
    logCacheError({ action: 'set', key, error })
  }
}

export type WithVersionedCacheResult<T> = {
  value: T
  cacheHit: boolean
}

/**
 * Read-through cache wrapper. Cache hit returns the cached value and
 * `cacheHit: true`. Cache miss runs `loader()`, stores the result, and
 * returns `cacheHit: false`. Caller can use `cacheHit` to log hit rate.
 *
 * The loader is **always** awaited on a miss — there is no negative
 * caching, no thundering-herd protection. For most read paths the
 * miss-rate is bounded by `scheduleConfigVersion` bump frequency,
 * which is order-of-seconds at most.
 */
export async function withVersionedCache<T>(
  key: VersionedCacheKey,
  loader: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<WithVersionedCacheResult<T>> {
  const cached = await getCached<T>(key)
  if (cached !== null) {
    return { value: cached, cacheHit: true }
  }

  const value = await loader()
  await setCached(key, value, ttlSeconds)
  return { value, cacheHit: false }
}
