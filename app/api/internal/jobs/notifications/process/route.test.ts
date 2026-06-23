import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const NOW = new Date('2026-04-13T18:30:00.000Z')

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  drainDueNotifications: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/notifications/delivery/runNotificationDrain', () => ({
  drainDueNotifications: mocks.drainDueNotifications,
  NOTIFICATION_DRAIN_DEFAULT_BATCH: 100,
  NOTIFICATION_DRAIN_MAX_BATCH: 250,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { GET, POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeRequest(args?: {
  method?: 'GET' | 'POST'
  url?: string
  authorization?: string
  internalSecret?: string
}): Request {
  const headers = new Headers()

  if (args?.authorization) {
    headers.set('authorization', args.authorization)
  }

  if (args?.internalSecret) {
    headers.set('x-internal-job-secret', args.internalSecret)
  }

  return new Request(
    args?.url ?? 'http://localhost/api/internal/jobs/notifications/process',
    {
      method: args?.method ?? 'GET',
      headers,
    },
  )
}

describe('app/api/internal/jobs/notifications/process/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET
    process.env.INTERNAL_JOB_SECRET = 'job_secret_1'

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.jsonOk.mockImplementation((data: Record<string, unknown>) =>
      makeJsonResponse(200, {
        ok: true,
        ...data,
      }),
    )

    mocks.drainDueNotifications.mockResolvedValue({
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET
  })

  it('GET returns 500 when no job secret is configured', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    })

    expect(mocks.drainDueNotifications).not.toHaveBeenCalled()
  })

  it('GET returns 401 when request is unauthorized', async () => {
    const result = await GET(makeRequest())

    expect(result.status).toBe(401)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.drainDueNotifications).not.toHaveBeenCalled()
  })

  it('GET clamps take, drains due deliveries, and returns the summary', async () => {
    const result = await GET(
      makeRequest({
        url: 'http://localhost/api/internal/jobs/notifications/process?take=999',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.drainDueNotifications).toHaveBeenCalledWith({
      batchSize: 250,
      now: NOW,
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      take: 250,
      processedAt: NOW.toISOString(),
    })
  })

  it('POST accepts x-internal-job-secret and uses default take', async () => {
    const result = await POST(
      makeRequest({
        method: 'POST',
        internalSecret: 'job_secret_1',
      }),
    )

    expect(mocks.drainDueNotifications).toHaveBeenCalledWith({
      batchSize: 100,
      now: NOW,
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      take: 100,
      processedAt: NOW.toISOString(),
    })
  })

  it('uses CRON_SECRET when INTERNAL_JOB_SECRET is missing', async () => {
    delete process.env.INTERNAL_JOB_SECRET
    process.env.CRON_SECRET = 'cron_secret_1'

    const result = await GET(
      makeRequest({
        authorization: 'Bearer cron_secret_1',
      }),
    )

    expect(result.status).toBe(200)
    expect(mocks.drainDueNotifications).toHaveBeenCalled()
  })

  it('POST logs safely and returns generic 500 when draining throws', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error('delivery failed for tori@example.com token secret')
    mocks.drainDueNotifications.mockRejectedValueOnce(thrown)

    const result = await POST(
      makeRequest({
        method: 'POST',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'POST /api/internal/jobs/notifications/process error',
      {
        error: {
          name: 'Error',
          message: 'delivery failed for tori@example.com token secret',
        },
      },
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    consoleErrorSpy.mockRestore()
  })
})
