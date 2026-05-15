// lib/health/checks.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HealthCheckName, HealthCheckResult, HealthStatus } from './types'

const healthProbeMocks = vi.hoisted(() => ({
  checkPostgresHealth: vi.fn(),
  checkRedisHealth: vi.fn(),
  checkStorageHealth: vi.fn(),
  checkStripeHealth: vi.fn(),
  checkPostmarkHealth: vi.fn(),
  checkTwilioHealth: vi.fn(),
}))

vi.mock('./postgres', () => ({
  checkPostgresHealth: healthProbeMocks.checkPostgresHealth,
}))

vi.mock('./redis', () => ({
  checkRedisHealth: healthProbeMocks.checkRedisHealth,
}))

vi.mock('./storage', () => ({
  checkStorageHealth: healthProbeMocks.checkStorageHealth,
}))

vi.mock('./stripe', () => ({
  checkStripeHealth: healthProbeMocks.checkStripeHealth,
}))

vi.mock('./postmark', () => ({
  checkPostmarkHealth: healthProbeMocks.checkPostmarkHealth,
}))

vi.mock('./twilio', () => ({
  checkTwilioHealth: healthProbeMocks.checkTwilioHealth,
}))

import {
  readHealthReadyOptions,
  runLiveChecks,
  runReadyChecks,
} from './checks'

function makeCheck(
  name: HealthCheckName,
  status: HealthStatus = 'ok',
): HealthCheckResult {
  return {
    name,
    status,
    latencyMs: 10,
    checkedAt: '2026-05-15T12:00:00.000Z',
    message: `${name} ${status}`,
  }
}

function resetHealthEnv(): void {
  delete process.env.HEALTH_READY_DEGRADED_RETURNS_503
  delete process.env.HEALTH_CHECK_PROVIDERS_LIVE
}

function mockHealthyReadyChecks(): void {
  healthProbeMocks.checkPostgresHealth.mockResolvedValue(makeCheck('postgres'))
  healthProbeMocks.checkRedisHealth.mockResolvedValue(makeCheck('redis'))
  healthProbeMocks.checkStorageHealth.mockResolvedValue(makeCheck('storage'))
  healthProbeMocks.checkStripeHealth.mockResolvedValue(makeCheck('stripe'))
  healthProbeMocks.checkPostmarkHealth.mockResolvedValue(makeCheck('postmark'))
  healthProbeMocks.checkTwilioHealth.mockResolvedValue(makeCheck('twilio'))
}

beforeEach(() => {
  vi.clearAllMocks()
  resetHealthEnv()
  mockHealthyReadyChecks()
})

afterEach(() => {
  resetHealthEnv()
  vi.useRealTimers()
})

describe('readHealthReadyOptions', () => {
  it('defaults degradedReturns503 and providerLiveChecksEnabled to false', () => {
    expect(readHealthReadyOptions()).toEqual({
      degradedReturns503: false,
      providerLiveChecksEnabled: false,
    })
  })

  it('reads boolean-like true values from the environment', () => {
    process.env.HEALTH_READY_DEGRADED_RETURNS_503 = 'yes'
    process.env.HEALTH_CHECK_PROVIDERS_LIVE = '1'

    expect(readHealthReadyOptions()).toEqual({
      degradedReturns503: true,
      providerLiveChecksEnabled: true,
    })
  })

  it('treats non-true values as false', () => {
    process.env.HEALTH_READY_DEGRADED_RETURNS_503 = 'false'
    process.env.HEALTH_CHECK_PROVIDERS_LIVE = 'no'

    expect(readHealthReadyOptions()).toEqual({
      degradedReturns503: false,
      providerLiveChecksEnabled: false,
    })
  })
})

describe('runLiveChecks', () => {
  it('returns an app-only live health response', async () => {
    const result = await runLiveChecks()

    expect(result.statusCode).toBe(200)
    expect(result.response.service).toBe('tovis-app')
    expect(result.response.endpoint).toBe('live')
    expect(result.response.status).toBe('ok')
    expect(result.response.checks.app).toMatchObject({
      name: 'app',
      status: 'ok',
    })

    expect(result.response.checks.postgres).toBeUndefined()
    expect(healthProbeMocks.checkPostgresHealth).not.toHaveBeenCalled()
    expect(healthProbeMocks.checkRedisHealth).not.toHaveBeenCalled()
    expect(healthProbeMocks.checkStorageHealth).not.toHaveBeenCalled()
    expect(healthProbeMocks.checkStripeHealth).not.toHaveBeenCalled()
    expect(healthProbeMocks.checkPostmarkHealth).not.toHaveBeenCalled()
    expect(healthProbeMocks.checkTwilioHealth).not.toHaveBeenCalled()
  })
})

describe('runReadyChecks', () => {
  it('runs every ready probe and returns ok when all probes are ok', async () => {
    const result = await runReadyChecks()

    expect(result.statusCode).toBe(200)
    expect(result.response.service).toBe('tovis-app')
    expect(result.response.endpoint).toBe('ready')
    expect(result.response.status).toBe('ok')

    expect(result.response.checks.postgres?.status).toBe('ok')
    expect(result.response.checks.redis?.status).toBe('ok')
    expect(result.response.checks.storage?.status).toBe('ok')
    expect(result.response.checks.stripe?.status).toBe('ok')
    expect(result.response.checks.postmark?.status).toBe('ok')
    expect(result.response.checks.twilio?.status).toBe('ok')

    expect(healthProbeMocks.checkPostgresHealth).toHaveBeenCalledTimes(1)
    expect(healthProbeMocks.checkRedisHealth).toHaveBeenCalledTimes(1)
    expect(healthProbeMocks.checkStorageHealth).toHaveBeenCalledTimes(1)
    expect(healthProbeMocks.checkStripeHealth).toHaveBeenCalledTimes(1)
    expect(healthProbeMocks.checkPostmarkHealth).toHaveBeenCalledTimes(1)
    expect(healthProbeMocks.checkTwilioHealth).toHaveBeenCalledTimes(1)
  })

  it('passes provider live-check configuration to provider probes', async () => {
    process.env.HEALTH_CHECK_PROVIDERS_LIVE = 'true'

    await runReadyChecks()

    expect(healthProbeMocks.checkStripeHealth).toHaveBeenCalledWith({
      timeoutMs: 3000,
      liveCheckEnabled: true,
    })

    expect(healthProbeMocks.checkPostmarkHealth).toHaveBeenCalledWith({
      timeoutMs: 3000,
      liveCheckEnabled: true,
    })

    expect(healthProbeMocks.checkTwilioHealth).toHaveBeenCalledWith({
      timeoutMs: 3000,
      liveCheckEnabled: true,
    })
  })

  it('allows explicit options to override environment options', async () => {
    process.env.HEALTH_CHECK_PROVIDERS_LIVE = 'false'

    await runReadyChecks({
      providerLiveChecksEnabled: true,
    })

    expect(healthProbeMocks.checkStripeHealth).toHaveBeenCalledWith({
      timeoutMs: 3000,
      liveCheckEnabled: true,
    })

    expect(healthProbeMocks.checkPostmarkHealth).toHaveBeenCalledWith({
      timeoutMs: 3000,
      liveCheckEnabled: true,
    })

    expect(healthProbeMocks.checkTwilioHealth).toHaveBeenCalledWith({
      timeoutMs: 3000,
      liveCheckEnabled: true,
    })
  })

  it('returns degraded when a degraded-only dependency reports degraded', async () => {
    healthProbeMocks.checkRedisHealth.mockResolvedValue(
      makeCheck('redis', 'degraded'),
    )

    const result = await runReadyChecks()

    expect(result.statusCode).toBe(200)
    expect(result.response.status).toBe('degraded')
    expect(result.response.checks.redis?.status).toBe('degraded')
    expect(result.response.checks.postgres?.status).toBe('ok')
  })

  it('returns 503 for degraded when degradedReturns503 is enabled', async () => {
    healthProbeMocks.checkRedisHealth.mockResolvedValue(
      makeCheck('redis', 'degraded'),
    )

    const result = await runReadyChecks({
      degradedReturns503: true,
    })

    expect(result.statusCode).toBe(503)
    expect(result.response.status).toBe('degraded')
  })

  it('returns down when Postgres reports down', async () => {
    healthProbeMocks.checkPostgresHealth.mockResolvedValue(
      makeCheck('postgres', 'down'),
    )

    const result = await runReadyChecks()

    expect(result.statusCode).toBe(503)
    expect(result.response.status).toBe('down')
    expect(result.response.checks.postgres?.status).toBe('down')
  })

  it('converts a thrown critical probe into a down check instead of crashing', async () => {
    healthProbeMocks.checkPostgresHealth.mockRejectedValue(
      new Error('database is unavailable'),
    )

    const result = await runReadyChecks()

    expect(result.statusCode).toBe(503)
    expect(result.response.status).toBe('down')
    expect(result.response.checks.postgres).toMatchObject({
      name: 'postgres',
      status: 'down',
      message: 'database is unavailable',
      details: {
        timeoutMs: 2000,
      },
    })
  })

  it('converts a thrown degraded-only probe into a degraded check instead of crashing', async () => {
    healthProbeMocks.checkStorageHealth.mockRejectedValue(
      new Error('storage unavailable'),
    )

    const result = await runReadyChecks()

    expect(result.statusCode).toBe(200)
    expect(result.response.status).toBe('degraded')
    expect(result.response.checks.storage).toMatchObject({
      name: 'storage',
      status: 'degraded',
      message: 'storage unavailable',
      details: {
        timeoutMs: 2000,
      },
    })
  })

  it('still includes other checks when one probe fails', async () => {
    healthProbeMocks.checkTwilioHealth.mockRejectedValue(
      new Error('twilio unavailable'),
    )

    const result = await runReadyChecks()

    expect(result.response.status).toBe('degraded')
    expect(result.response.checks.twilio?.status).toBe('degraded')
    expect(result.response.checks.postgres?.status).toBe('ok')
    expect(result.response.checks.redis?.status).toBe('ok')
    expect(result.response.checks.storage?.status).toBe('ok')
    expect(result.response.checks.stripe?.status).toBe('ok')
    expect(result.response.checks.postmark?.status).toBe('ok')
  })
})