// lib/health/postgres.ts

import { prisma } from '@/lib/prisma'

import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  type HealthCheckResult,
} from './types'

const POSTGRES_CHECK_NAME = 'postgres' as const

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unknown Postgres health check failure.'
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

async function pingPostgres(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`
}

export async function checkPostgresHealth(
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<HealthCheckResult> {
  const startedAt = Date.now()

  try {
    await withTimeout(pingPostgres(), timeoutMs, 'Postgres health check')

    return {
      name: POSTGRES_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Postgres is reachable.',
      details: {
        query: 'SELECT 1',
        timeoutMs,
      },
    }
  } catch (error: unknown) {
    return {
      name: POSTGRES_CHECK_NAME,
      status: 'down',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: getErrorMessage(error),
      details: {
        query: 'SELECT 1',
        timeoutMs,
      },
    }
  }
}