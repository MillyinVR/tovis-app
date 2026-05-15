// lib/health/stripe.ts

import { getStripe } from '@/lib/stripe/server'

import {
  DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
  type HealthCheckResult,
} from './types'

const STRIPE_CHECK_NAME = 'stripe' as const
const LIVE_PROVIDER_CHECK_ENV = 'HEALTH_CHECK_PROVIDERS_LIVE'

type StripeHealthOptions = Readonly<{
  timeoutMs?: number
  liveCheckEnabled?: boolean
}>

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unknown Stripe health check failure.'
}

function isLiveProviderCheckEnabled(): boolean {
  return process.env[LIVE_PROVIDER_CHECK_ENV]?.trim().toLowerCase() === 'true'
}

function hasStripeSecretKey(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
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

async function pingStripe(): Promise<void> {
  const stripe = getStripe()
  await stripe.balance.retrieve()
}

export async function checkStripeHealth(
  options: StripeHealthOptions = {},
): Promise<HealthCheckResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS
  const liveCheckEnabled =
    options.liveCheckEnabled ?? isLiveProviderCheckEnabled()

  if (!hasStripeSecretKey()) {
    return {
      name: STRIPE_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Stripe is not configured. Missing STRIPE_SECRET_KEY.',
      details: {
        timeoutMs,
        liveCheckEnabled,
      },
    }
  }

  if (!liveCheckEnabled) {
    return {
      name: STRIPE_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Stripe configuration is present. Live provider check is disabled.',
      details: {
        timeoutMs,
        liveCheckEnabled,
      },
    }
  }

  try {
    await withTimeout(pingStripe(), timeoutMs, 'Stripe health check')

    return {
      name: STRIPE_CHECK_NAME,
      status: 'ok',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: 'Stripe is reachable.',
      details: {
        timeoutMs,
        liveCheckEnabled,
      },
    }
  } catch (error: unknown) {
    return {
      name: STRIPE_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: getErrorMessage(error),
      details: {
        timeoutMs,
        liveCheckEnabled,
      },
    }
  }
}