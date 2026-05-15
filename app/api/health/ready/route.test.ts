// app/api/health/ready/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const healthChecksMock = vi.hoisted(() => ({
  runReadyChecks: vi.fn(),
}))

vi.mock('@/lib/health/checks', () => ({
  runReadyChecks: healthChecksMock.runReadyChecks,
}))

import { GET, dynamic, runtime } from './route'

describe('GET /api/health/ready', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    healthChecksMock.runReadyChecks.mockResolvedValue({
      statusCode: 200,
      response: {
        service: 'tovis-app',
        endpoint: 'ready',
        status: 'ok',
        timestamp: '2026-05-15T12:00:00.000Z',
        durationMs: 18,
        checks: {
          postgres: {
            name: 'postgres',
            status: 'ok',
            latencyMs: 4,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Postgres is reachable.',
          },
          redis: {
            name: 'redis',
            status: 'ok',
            latencyMs: 3,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Redis is reachable.',
          },
          storage: {
            name: 'storage',
            status: 'ok',
            latencyMs: 5,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Supabase Storage buckets are reachable.',
          },
          stripe: {
            name: 'stripe',
            status: 'ok',
            latencyMs: 1,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message:
              'Stripe configuration is present. Live provider check is disabled.',
          },
          postmark: {
            name: 'postmark',
            status: 'ok',
            latencyMs: 2,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message:
              'Postmark configuration is present. Live provider check is disabled.',
          },
          twilio: {
            name: 'twilio',
            status: 'ok',
            latencyMs: 3,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message:
              'Twilio configuration is present. Live provider check is disabled.',
          },
        },
      },
    })
  })

  it('is dynamic and uses the Node.js runtime', () => {
    expect(dynamic).toBe('force-dynamic')
    expect(runtime).toBe('nodejs')
  })

  it('delegates to runReadyChecks and returns the readiness response', async () => {
    const response = await GET()
    const body = await response.json()

    expect(healthChecksMock.runReadyChecks).toHaveBeenCalledTimes(1)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toEqual({
      ok: true,
      service: 'tovis-app',
      endpoint: 'ready',
      status: 'ok',
      timestamp: '2026-05-15T12:00:00.000Z',
      durationMs: 18,
      checks: {
        postgres: {
          name: 'postgres',
          status: 'ok',
          latencyMs: 4,
          checkedAt: '2026-05-15T12:00:00.000Z',
          message: 'Postgres is reachable.',
        },
        redis: {
          name: 'redis',
          status: 'ok',
          latencyMs: 3,
          checkedAt: '2026-05-15T12:00:00.000Z',
          message: 'Redis is reachable.',
        },
        storage: {
          name: 'storage',
          status: 'ok',
          latencyMs: 5,
          checkedAt: '2026-05-15T12:00:00.000Z',
          message: 'Supabase Storage buckets are reachable.',
        },
        stripe: {
          name: 'stripe',
          status: 'ok',
          latencyMs: 1,
          checkedAt: '2026-05-15T12:00:00.000Z',
          message:
            'Stripe configuration is present. Live provider check is disabled.',
        },
        postmark: {
          name: 'postmark',
          status: 'ok',
          latencyMs: 2,
          checkedAt: '2026-05-15T12:00:00.000Z',
          message:
            'Postmark configuration is present. Live provider check is disabled.',
        },
        twilio: {
          name: 'twilio',
          status: 'ok',
          latencyMs: 3,
          checkedAt: '2026-05-15T12:00:00.000Z',
          message:
            'Twilio configuration is present. Live provider check is disabled.',
        },
      },
    })
  })

  it('returns degraded readiness using the status code from the health layer', async () => {
    healthChecksMock.runReadyChecks.mockResolvedValueOnce({
      statusCode: 200,
      response: {
        service: 'tovis-app',
        endpoint: 'ready',
        status: 'degraded',
        timestamp: '2026-05-15T12:00:00.000Z',
        durationMs: 21,
        checks: {
          postgres: {
            name: 'postgres',
            status: 'ok',
            latencyMs: 4,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Postgres is reachable.',
          },
          redis: {
            name: 'redis',
            status: 'degraded',
            latencyMs: 17,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Redis health check read-after-write verification failed.',
          },
        },
      },
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      service: 'tovis-app',
      endpoint: 'ready',
      status: 'degraded',
      checks: {
        postgres: {
          name: 'postgres',
          status: 'ok',
        },
        redis: {
          name: 'redis',
          status: 'degraded',
        },
      },
    })
  })

  it('returns 503 when the health layer reports readiness down', async () => {
    healthChecksMock.runReadyChecks.mockResolvedValueOnce({
      statusCode: 503,
      response: {
        service: 'tovis-app',
        endpoint: 'ready',
        status: 'down',
        timestamp: '2026-05-15T12:00:00.000Z',
        durationMs: 28,
        checks: {
          postgres: {
            name: 'postgres',
            status: 'down',
            latencyMs: 28,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Postgres health check timed out after 2000ms.',
          },
          redis: {
            name: 'redis',
            status: 'ok',
            latencyMs: 3,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Redis is reachable.',
          },
        },
      },
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      ok: true,
      service: 'tovis-app',
      endpoint: 'ready',
      status: 'down',
      checks: {
        postgres: {
          name: 'postgres',
          status: 'down',
        },
        redis: {
          name: 'redis',
          status: 'ok',
        },
      },
    })
  })
})