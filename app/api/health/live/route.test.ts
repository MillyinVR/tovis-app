// app/api/health/live/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const healthChecksMock = vi.hoisted(() => ({
  runLiveChecks: vi.fn(),
}))

vi.mock('@/lib/health/checks', () => ({
  runLiveChecks: healthChecksMock.runLiveChecks,
}))

import { GET, dynamic, runtime } from './route'

describe('GET /api/health/live', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    healthChecksMock.runLiveChecks.mockResolvedValue({
      statusCode: 200,
      response: {
        service: 'tovis-app',
        endpoint: 'live',
        status: 'ok',
        timestamp: '2026-05-15T12:00:00.000Z',
        durationMs: 3,
        checks: {
          app: {
            name: 'app',
            status: 'ok',
            latencyMs: 1,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Application process is responding.',
          },
        },
      },
    })
  })

  it('is dynamic and uses the Node.js runtime', () => {
    expect(dynamic).toBe('force-dynamic')
    expect(runtime).toBe('nodejs')
  })

  it('delegates to runLiveChecks and returns the health response', async () => {
    const response = await GET()
    const body = await response.json()

    expect(healthChecksMock.runLiveChecks).toHaveBeenCalledTimes(1)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toEqual({
      ok: true,
      service: 'tovis-app',
      endpoint: 'live',
      status: 'ok',
      timestamp: '2026-05-15T12:00:00.000Z',
      durationMs: 3,
      checks: {
        app: {
          name: 'app',
          status: 'ok',
          latencyMs: 1,
          checkedAt: '2026-05-15T12:00:00.000Z',
          message: 'Application process is responding.',
        },
      },
    })
  })

  it('uses the status code returned by the health layer', async () => {
    healthChecksMock.runLiveChecks.mockResolvedValueOnce({
      statusCode: 503,
      response: {
        service: 'tovis-app',
        endpoint: 'live',
        status: 'down',
        timestamp: '2026-05-15T12:00:00.000Z',
        durationMs: 5,
        checks: {
          app: {
            name: 'app',
            status: 'down',
            latencyMs: 5,
            checkedAt: '2026-05-15T12:00:00.000Z',
            message: 'Application process is not healthy.',
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
      endpoint: 'live',
      status: 'down',
    })
  })
})