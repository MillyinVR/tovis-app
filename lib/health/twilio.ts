// lib/health/twilio.ts

import { readTwilioSmsConfig } from '@/lib/notifications/config'

import {
  DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
  type HealthCheckResult,
} from './types'

const TWILIO_CHECK_NAME = 'twilio' as const
const LIVE_PROVIDER_CHECK_ENV = 'HEALTH_CHECK_PROVIDERS_LIVE'

type TwilioHealthOptions = Readonly<{
  timeoutMs?: number
  liveCheckEnabled?: boolean
}>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unknown Twilio health check failure.'
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

function buildTwilioAccountUrl(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    accountSid,
  )}.json`
}

function buildBasicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
}

async function pingTwilio(
  accountSid: string,
  authToken: string,
): Promise<void> {
  const response = await fetch(buildTwilioAccountUrl(accountSid), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: buildBasicAuthHeader(accountSid, authToken),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Twilio health check failed with HTTP ${response.status}.`)
  }
}

export async function checkTwilioHealth(
  options: TwilioHealthOptions = {},
): Promise<HealthCheckResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS
  const liveCheckEnabled =
    options.liveCheckEnabled ?? isLiveProviderCheckEnabled()

  const config = readTwilioSmsConfig()

  if (config === null) {
    return {
      name: TWILIO_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Twilio SMS is not configured.',
      details: {
        timeoutMs,
        liveCheckEnabled,
      },
    }
  }

  if (!liveCheckEnabled) {
    return {
      name: TWILIO_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message:
        'Twilio configuration is present. Live provider check is disabled.',
      details: {
        timeoutMs,
        liveCheckEnabled,
        fromNumberConfigured: Boolean(config.fromNumber),
      },
    }
  }

  try {
    await withTimeout(
      pingTwilio(config.accountSid, config.authToken),
      timeoutMs,
      'Twilio health check',
    )

    return {
      name: TWILIO_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Twilio is reachable.',
      details: {
        timeoutMs,
        liveCheckEnabled,
        fromNumberConfigured: Boolean(config.fromNumber),
      },
    }
  } catch (error: unknown) {
    return {
      name: TWILIO_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: getErrorMessage(error),
      details: {
        timeoutMs,
        liveCheckEnabled,
        fromNumberConfigured: Boolean(config.fromNumber),
      },
    }
  }
}