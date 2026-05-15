// lib/health/checks.ts

import { checkPostgresHealth } from './postgres'
import { checkPostmarkHealth } from './postmark'
import { checkRedisHealth } from './redis'
import { buildHealthResponse, buildLiveHealthResponse } from './summary'
import { checkStorageHealth } from './storage'
import { checkStripeHealth } from './stripe'
import { checkTwilioHealth } from './twilio'
import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
  READY_CHECK_CRITICALITY,
  type HealthCheckName,
  type HealthCheckResult,
  type HealthProbe,
  type HealthReadyOptions,
  type HealthRouteResult,
  type HealthStatus,
} from './types'

const HEALTH_READY_DEGRADED_RETURNS_503_ENV =
  'HEALTH_READY_DEGRADED_RETURNS_503'

const HEALTH_CHECK_PROVIDERS_LIVE_ENV = 'HEALTH_CHECK_PROVIDERS_LIVE'

type ReadyProbeDefinition = Readonly<{
  name: Exclude<HealthCheckName, 'app'>
  timeoutMs: number
  probe: HealthProbe
}>

function readBooleanEnv(name: string, defaultValue = false): boolean {
  const value = process.env[name]?.trim().toLowerCase()

  if (!value) {
    return defaultValue
  }

  return value === 'true' || value === '1' || value === 'yes'
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unknown health check failure.'
}

function fallbackStatusForCheck(
  name: Exclude<HealthCheckName, 'app'>,
): HealthStatus {
  return READY_CHECK_CRITICALITY[name] === 'critical' ? 'down' : 'degraded'
}

function timeoutHealthCheck(
  name: Exclude<HealthCheckName, 'app'>,
  timeoutMs: number,
): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${name} health check timed out after ${timeoutMs}ms.`))
    }, timeoutMs)
  })
}

async function runSafeReadyProbe({
  name,
  timeoutMs,
  probe,
}: ReadyProbeDefinition): Promise<HealthCheckResult> {
  const startedAt = Date.now()

  try {
    return await Promise.race([probe(), timeoutHealthCheck(name, timeoutMs)])
  } catch (error: unknown) {
    return {
      name,
      status: fallbackStatusForCheck(name),
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: new Date().toISOString(),
      message: getErrorMessage(error),
      details: {
        timeoutMs,
      },
    }
  }
}

export function readHealthReadyOptions(): HealthReadyOptions {
  return {
    degradedReturns503: readBooleanEnv(
      HEALTH_READY_DEGRADED_RETURNS_503_ENV,
      false,
    ),
    providerLiveChecksEnabled: readBooleanEnv(
      HEALTH_CHECK_PROVIDERS_LIVE_ENV,
      false,
    ),
  }
}

export async function runLiveChecks(
  startedAt = Date.now(),
): Promise<HealthRouteResult> {
  return buildLiveHealthResponse(startedAt)
}

export async function runReadyChecks(
  options: Partial<HealthReadyOptions> = {},
): Promise<HealthRouteResult> {
  const startedAt = Date.now()
  const envOptions = readHealthReadyOptions()

  const degradedReturns503 =
    options.degradedReturns503 ?? envOptions.degradedReturns503

  const providerLiveChecksEnabled =
    options.providerLiveChecksEnabled ?? envOptions.providerLiveChecksEnabled

  const readyProbes: readonly ReadyProbeDefinition[] = [
    {
      name: 'postgres',
      timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
      probe: () => checkPostgresHealth(DEFAULT_HEALTH_TIMEOUT_MS),
    },
    {
      name: 'redis',
      timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
      probe: () => checkRedisHealth(DEFAULT_HEALTH_TIMEOUT_MS),
    },
    {
      name: 'storage',
      timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
      probe: () => checkStorageHealth(DEFAULT_HEALTH_TIMEOUT_MS),
    },
    {
      name: 'stripe',
      timeoutMs: DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
      probe: () =>
        checkStripeHealth({
          timeoutMs: DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
          liveCheckEnabled: providerLiveChecksEnabled,
        }),
    },
    {
      name: 'postmark',
      timeoutMs: DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
      probe: () =>
        checkPostmarkHealth({
          timeoutMs: DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
          liveCheckEnabled: providerLiveChecksEnabled,
        }),
    },
    {
      name: 'twilio',
      timeoutMs: DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
      probe: () =>
        checkTwilioHealth({
          timeoutMs: DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS,
          liveCheckEnabled: providerLiveChecksEnabled,
        }),
    },
  ]

  const checks = await Promise.all(
    readyProbes.map((definition) => runSafeReadyProbe(definition)),
  )

  return buildHealthResponse({
    endpoint: 'ready',
    checks,
    startedAt,
    degradedReturns503,
  })
}