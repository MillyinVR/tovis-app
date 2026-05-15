// lib/health/storage.ts

import { getSupabaseAdmin, STORAGE_BUCKETS } from '@/lib/supabaseAdmin'

import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  type HealthCheckResult,
} from './types'

const STORAGE_CHECK_NAME = 'storage' as const

type BucketCheckResult = Readonly<{
  name: string
  ok: boolean
  message?: string
}>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unknown Supabase Storage health check failure.'
}

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

async function checkBucket(name: string): Promise<BucketCheckResult> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.getBucket(name)

  if (error !== null) {
    return {
      name,
      ok: false,
      message: error.message,
    }
  }

  if (!data) {
    return {
      name,
      ok: false,
      message: 'Bucket lookup returned no bucket data.',
    }
  }

  return {
    name,
    ok: true,
  }
}

async function checkStorageBuckets(): Promise<readonly BucketCheckResult[]> {
  const buckets = [
    STORAGE_BUCKETS.mediaPrivate,
    STORAGE_BUCKETS.mediaPublic,
  ] as const

  return Promise.all(buckets.map((bucket) => checkBucket(bucket)))
}

export async function checkStorageHealth(
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<HealthCheckResult> {
  const startedAt = Date.now()

  try {
    const bucketResults = await withTimeout(
      checkStorageBuckets(),
      timeoutMs,
      'Supabase Storage health check',
    )

    const failedBuckets = bucketResults.filter((bucket) => !bucket.ok)

    if (failedBuckets.length > 0) {
      return {
        name: STORAGE_CHECK_NAME,
        status: 'degraded',
        latencyMs: Math.max(0, Date.now() - startedAt),
        checkedAt: new Date().toISOString(),
        message: 'One or more Supabase Storage buckets are not reachable.',
        details: {
          timeoutMs,
          checkedBuckets: bucketResults.map((bucket) => bucket.name),
          failedBuckets: failedBuckets.map((bucket) => bucket.name),
        },
      }
    }

    return {
      name: STORAGE_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Supabase Storage buckets are reachable.',
      details: {
        timeoutMs,
        checkedBuckets: bucketResults.map((bucket) => bucket.name),
      },
    }
  } catch (error: unknown) {
    return {
      name: STORAGE_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: getErrorMessage(error),
      details: {
        timeoutMs,
      },
    }
  }
}