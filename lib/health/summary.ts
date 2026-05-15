// lib/health/summary.ts

import {
  HEALTH_SERVICE_NAME,
  HEALTH_STATUS_PRIORITY,
  type HealthCheckName,
  type HealthCheckResult,
  type HealthChecks,
  type HealthEndpoint,
  type HealthResponse,
  type HealthRouteResult,
  type HealthStatus,
} from './types'

type BuildHealthResponseInput = Readonly<{
  endpoint: HealthEndpoint
  checks: readonly HealthCheckResult[]
  startedAt: number
  degradedReturns503?: boolean
}>

const HTTP_OK = 200
const HTTP_SERVICE_UNAVAILABLE = 503

export function getWorstHealthStatus(
  statuses: readonly HealthStatus[],
): HealthStatus {
  if (statuses.length === 0) {
    return 'down'
  }

  return statuses.reduce<HealthStatus>((worst, current) => {
    return HEALTH_STATUS_PRIORITY[current] > HEALTH_STATUS_PRIORITY[worst]
      ? current
      : worst
  }, 'ok')
}

export function checksToRecord(
  checks: readonly HealthCheckResult[],
): HealthChecks {
  return checks.reduce<Partial<Record<HealthCheckName, HealthCheckResult>>>(
    (record, check) => {
      record[check.name] = check
      return record
    },
    {},
  )
}

export function getHealthStatusCode(
  status: HealthStatus,
  options?: Readonly<{ degradedReturns503?: boolean }>,
): number {
  if (status === 'down') {
    return HTTP_SERVICE_UNAVAILABLE
  }

  if (status === 'degraded' && options?.degradedReturns503 === true) {
    return HTTP_SERVICE_UNAVAILABLE
  }

  return HTTP_OK
}

export function buildHealthResponse({
  endpoint,
  checks,
  startedAt,
  degradedReturns503 = false,
}: BuildHealthResponseInput): HealthRouteResult {
  const status = getWorstHealthStatus(checks.map((check) => check.status))
  const durationMs = Math.max(0, Date.now() - startedAt)

  const response: HealthResponse = {
    service: HEALTH_SERVICE_NAME,
    endpoint,
    status,
    timestamp: new Date().toISOString(),
    durationMs,
    checks: checksToRecord(checks),
  }

  return {
    response,
    statusCode: getHealthStatusCode(status, { degradedReturns503 }),
  }
}

export function buildLiveHealthResponse(startedAt: number): HealthRouteResult {
  const checkedAt = new Date().toISOString()

  return buildHealthResponse({
    endpoint: 'live',
    startedAt,
    checks: [
      {
        name: 'app',
        status: 'ok',
        latencyMs: Math.max(0, Date.now() - startedAt),
        checkedAt,
        message: 'Application process is responding.',
      },
    ],
  })
}