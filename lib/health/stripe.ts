// lib/health/stripe.ts

import { getStripe } from '@/lib/stripe/server'
import {
  stripeKeyMode,
  stripeKeyModesAgree,
  type StripeKeyMode,
} from '@/lib/stripe/keyMode'

import { errorMessageFromUnknown } from '@/lib/http'
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

/**
 * The Stripe key modes, for the readiness payload. Reported on EVERY branch of
 * the check below — including the unconfigured one — because "which mode is this
 * environment in?" is exactly the question you are asking when Stripe looks
 * broken, and a branch that omits it sends you back to guessing.
 *
 * Both env vars are read as STATIC references: Next only inlines a
 * `NEXT_PUBLIC_*` var where it is spelled out literally, so a computed
 * `process.env[name]` lookup would read as undefined in a built client bundle.
 *
 * Modes only — never the keys. See lib/stripe/keyMode.ts.
 *
 * ⚠️ /api/health/ready is UNAUTHENTICATED, so weigh what this discloses. It is a
 * mode, never key material — and a working Stripe integration must have matching
 * modes (Stripe rejects a cross-mode pair), so `secretKeyMode` reveals nothing
 * that the publishable key, which Next inlines into a public client chunk, does
 * not already give away. The one case it does add signal is precisely the broken
 * one — a mismatched pair — which the operator needs to see more than an outsider
 * benefits from knowing. If that trade stops holding, gate these three fields
 * rather than dropping them: the whole point is that the mode is askable.
 */
function stripeKeyModeDetails(): Readonly<{
  secretKeyMode: StripeKeyMode
  publishableKeyMode: StripeKeyMode
  keyModesAgree: boolean | null
}> {
  const secretKeyMode = stripeKeyMode(process.env.STRIPE_SECRET_KEY)
  const publishableKeyMode = stripeKeyMode(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  )

  return {
    secretKeyMode,
    publishableKeyMode,
    keyModesAgree: stripeKeyModesAgree(secretKeyMode, publishableKeyMode),
  }
}

export async function checkStripeHealth(
  options: StripeHealthOptions = {},
): Promise<HealthCheckResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS
  const liveCheckEnabled =
    options.liveCheckEnabled ?? isLiveProviderCheckEnabled()
  const keyModes = stripeKeyModeDetails()

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
        ...keyModes,
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
        ...keyModes,
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
        ...keyModes,
      },
    }
  } catch (error: unknown) {
    return {
      name: STRIPE_CHECK_NAME,
      status: 'degraded',
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: errorMessageFromUnknown(error, 'Unknown Stripe health check failure.'),
      details: {
        timeoutMs,
        liveCheckEnabled,
        ...keyModes,
      },
    }
  }
}