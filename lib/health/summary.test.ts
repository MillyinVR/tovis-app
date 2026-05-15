// lib/health/summary.test.ts

import { describe, expect, it, vi } from 'vitest'

import {
  buildHealthResponse,
  buildLiveHealthResponse,
  checksToRecord,
  getHealthStatusCode,
  getWorstHealthStatus,
} from './summary'

import type { HealthCheckResult } from './types'

function makeCheck(
  overrides: Partial<HealthCheckResult> & Pick<HealthCheckResult, 'name'>,
): HealthCheckResult {
  return {
    name: overrides.name,
    status: overrides.status ?? 'ok',
    latencyMs: overrides.latencyMs ?? 12,
    checkedAt: overrides.checkedAt ?? '2026-05-15T12:00:00.000Z',
    message: overrides.message,
    details: overrides.details,
  }
}

describe('getWorstHealthStatus', () => {
  it('returns ok when all statuses are ok', () => {
    expect(getWorstHealthStatus(['ok', 'ok', 'ok'])).toBe('ok')
  })

  it('returns degraded when at least one status is degraded and none are down', () => {
    expect(getWorstHealthStatus(['ok', 'degraded', 'ok'])).toBe('degraded')
  })

  it('returns down when any status is down', () => {
    expect(getWorstHealthStatus(['ok', 'degraded', 'down'])).toBe('down')
  })

  it('returns down for an empty status list', () => {
    expect(getWorstHealthStatus([])).toBe('down')
  })
})

describe('checksToRecord', () => {
  it('converts check results into a record keyed by check name', () => {
    const postgres = makeCheck({ name: 'postgres' })
    const redis = makeCheck({ name: 'redis', status: 'degraded' })

    expect(checksToRecord([postgres, redis])).toEqual({
      postgres,
      redis,
    })
  })
})

describe('getHealthStatusCode', () => {
  it('returns 200 for ok', () => {
    expect(getHealthStatusCode('ok')).toBe(200)
  })

  it('returns 200 for degraded by default', () => {
    expect(getHealthStatusCode('degraded')).toBe(200)
  })

  it('returns 503 for degraded when degradedReturns503 is true', () => {
    expect(getHealthStatusCode('degraded', { degradedReturns503: true })).toBe(
      503,
    )
  })

  it('returns 503 for down', () => {
    expect(getHealthStatusCode('down')).toBe(503)
  })
})

describe('buildHealthResponse', () => {
  it('builds an ok ready response', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:01.000Z'))

    const result = buildHealthResponse({
      endpoint: 'ready',
      startedAt: new Date('2026-05-15T12:00:00.000Z').getTime(),
      checks: [
        makeCheck({ name: 'postgres' }),
        makeCheck({ name: 'redis' }),
      ],
    })

    expect(result.statusCode).toBe(200)
    expect(result.response).toEqual({
      service: 'tovis-app',
      endpoint: 'ready',
      status: 'ok',
      timestamp: '2026-05-15T12:00:01.000Z',
      durationMs: 1000,
      checks: {
        postgres: makeCheck({ name: 'postgres' }),
        redis: makeCheck({ name: 'redis' }),
      },
    })

    vi.useRealTimers()
  })

  it('builds a degraded ready response and keeps status code 200 by default', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:01.000Z'))

    const result = buildHealthResponse({
      endpoint: 'ready',
      startedAt: new Date('2026-05-15T12:00:00.000Z').getTime(),
      checks: [
        makeCheck({ name: 'postgres' }),
        makeCheck({ name: 'redis', status: 'degraded' }),
      ],
    })

    expect(result.statusCode).toBe(200)
    expect(result.response.status).toBe('degraded')
    expect(result.response.checks.redis?.status).toBe('degraded')

    vi.useRealTimers()
  })

  it('builds a degraded ready response with status code 503 when configured', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:01.000Z'))

    const result = buildHealthResponse({
      endpoint: 'ready',
      startedAt: new Date('2026-05-15T12:00:00.000Z').getTime(),
      degradedReturns503: true,
      checks: [
        makeCheck({ name: 'postgres' }),
        makeCheck({ name: 'redis', status: 'degraded' }),
      ],
    })

    expect(result.statusCode).toBe(503)
    expect(result.response.status).toBe('degraded')

    vi.useRealTimers()
  })

  it('builds a down ready response with status code 503', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:01.000Z'))

    const result = buildHealthResponse({
      endpoint: 'ready',
      startedAt: new Date('2026-05-15T12:00:00.000Z').getTime(),
      checks: [
        makeCheck({ name: 'postgres', status: 'down' }),
        makeCheck({ name: 'redis' }),
      ],
    })

    expect(result.statusCode).toBe(503)
    expect(result.response.status).toBe('down')
    expect(result.response.checks.postgres?.status).toBe('down')

    vi.useRealTimers()
  })
})

describe('buildLiveHealthResponse', () => {
  it('builds a live response with only the app check', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:01.000Z'))

    const result = buildLiveHealthResponse(
      new Date('2026-05-15T12:00:00.000Z').getTime(),
    )

    expect(result.statusCode).toBe(200)
    expect(result.response.service).toBe('tovis-app')
    expect(result.response.endpoint).toBe('live')
    expect(result.response.status).toBe('ok')
    expect(result.response.durationMs).toBe(1000)
    expect(result.response.checks.app).toMatchObject({
      name: 'app',
      status: 'ok',
      message: 'Application process is responding.',
    })
    expect(result.response.checks.postgres).toBeUndefined()

    vi.useRealTimers()
  })
})