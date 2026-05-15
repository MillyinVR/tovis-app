// lib/health/postmark.ts

import { readPostmarkEmailConfig } from '@/lib/notifications/config'

import {
  DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
  type HealthCheckResult,
} from './types'

const POSTMARK_CHECK_NAME = 'postmark' as const
const LIVE_PROVIDER_CHECK_ENV = 'HEALTH_CHECK_PROVIDERS_LIVE'
const POSTMARK_SERVER_API_URL = 'https://api.postmarkapp.com/server'

type PostmarkHealthOptions = Readonly<{
  timeoutMs?: number
  liveCheckEnabled?: boolean
}>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unknown Postmark health check failure.'
}

function isLiveProviderCheckEnabled(): boolean {
  return process.env[LIVE_PROVIDER_CHECK_ENV]?.trim().toLowerCase() === 'true'
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

async function pingPostmark(serverToken: string): Promise<void> {
  const response = await fetch(POSTMARK_SERVER_API_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Postmark-Server-Token': serverToken,
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(
      `Postmark health check failed with HTTP ${response.status}.`,
    )
  }
}

export async function checkPostmarkHealth(
  options: PostmarkHealthOptions = {},
): Promise<HealthCheckResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS
  const liveCheckEnabled =
    options.liveCheckEnabled ?? isLiveProviderCheckEnabled()

  const config = readPostmarkEmailConfig()

  if (config === null) {
    return {
      name: POSTMARK_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Postmark email is not configured.',
      details: {
        timeoutMs,
        liveCheckEnabled,
      },
    }
  }

  if (!liveCheckEnabled) {
    return {
      name: POSTMARK_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message:
        'Postmark configuration is present. Live provider check is disabled.',
      details: {
        timeoutMs,
        liveCheckEnabled,
        fromEmailConfigured: Boolean(config.fromEmail),
        messageStreamConfigured: Boolean(config.messageStream),
      },
    }
  }

  try {
    await withTimeout(
      pingPostmark(config.serverToken),
      timeoutMs,
      'Postmark health check',
    )

    return {
      name: POSTMARK_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Postmark is reachable.',
      details: {
        timeoutMs,
        liveCheckEnabled,
        fromEmailConfigured: Boolean(config.fromEmail),
        messageStreamConfigured: Boolean(config.messageStream),
      },
    }
  } catch (error: unknown) {
    return {
      name: POSTMARK_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: getErrorMessage(error),
      details: {
        timeoutMs,
        liveCheckEnabled,
        fromEmailConfigured: Boolean(config.fromEmail),
        messageStreamConfigured: Boolean(config.messageStream),
      },
    }
  }
}