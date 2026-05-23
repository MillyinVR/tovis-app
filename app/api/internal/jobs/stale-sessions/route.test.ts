// app/api/internal/jobs/stale-sessions/route.test.ts
import { BookingStatus, SessionStep } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  bookingFindMany: vi.fn(),

  captureBookingException: vi.fn(),

  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'NonErrorThrown',
    message: error instanceof Error ? error.message : String(error),
  })),
  safeLogMeta: vi.fn((value: unknown) => value),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: mocks.bookingFindMany,
    },
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
  safeLogMeta: mocks.safeLogMeta,
}))

import { GET, POST } from './route'

const NOW = new Date('2026-04-13T18:30:00.000Z')

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

  return new Request('http://localhost/api/internal/jobs/stale-sessions', {
    method: args?.method ?? 'GET',
    headers,
  })
}

describe('app/api/internal/jobs/stale-sessions/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET
    delete process.env.STALE_PENDING_HOURS
    delete process.env.STALE_IN_PROGRESS_HOURS

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

    mocks.bookingFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
  })

  afterEach(() => {
    vi.useRealTimers()

    delete process.env.INTERNAL_JOB_SECRET
    delete process.env.CRON_SECRET
    delete process.env.STALE_PENDING_HOURS
    delete process.env.STALE_IN_PROGRESS_HOURS
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

    expect(mocks.bookingFindMany).not.toHaveBeenCalled()
  })

  it('GET returns 401 when request is not authorized', async () => {
    const result = await GET(makeRequest())

    expect(result.status).toBe(401)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.bookingFindMany).not.toHaveBeenCalled()
  })

  it('GET accepts bearer auth and returns stale observation counts', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)

    const stalePending = {
      id: 'booking_pending_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      createdAt: new Date('2026-04-10T18:30:00.000Z'),
      scheduledFor: new Date('2026-04-15T18:30:00.000Z'),
    }

    const staleInProgress = {
      id: 'booking_progress_1',
      professionalId: 'pro_2',
      clientId: 'client_2',
      sessionStep: SessionStep.BEFORE_PHOTOS,
      startedAt: new Date('2026-04-12T01:00:00.000Z'),
      updatedAt: new Date('2026-04-12T02:30:00.000Z'),
    }

    mocks.bookingFindMany
      .mockReset()
      .mockResolvedValueOnce([stalePending])
      .mockResolvedValueOnce([staleInProgress])

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(mocks.bookingFindMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: BookingStatus.PENDING,
        createdAt: {
          lte: new Date('2026-04-11T18:30:00.000Z'),
        },
      },
      select: {
        id: true,
        professionalId: true,
        clientId: true,
        createdAt: true,
        scheduledFor: true,
      },
      take: 500,
      orderBy: {
        createdAt: 'asc',
      },
    })

    expect(mocks.bookingFindMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: BookingStatus.IN_PROGRESS,
        updatedAt: {
          lte: new Date('2026-04-13T06:30:00.000Z'),
        },
      },
      select: {
        id: true,
        professionalId: true,
        clientId: true,
        sessionStep: true,
        startedAt: true,
        updatedAt: true,
      },
      take: 500,
      orderBy: {
        updatedAt: 'asc',
      },
    })

    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      kind: 'PENDING_NOT_ACCEPTED',
      bookingId: 'booking_pending_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      createdAt: '2026-04-10T18:30:00.000Z',
      scheduledFor: '2026-04-15T18:30:00.000Z',
      ageHours: 72,
      thresholdHours: 48,
      scannedAt: '2026-04-13T18:30:00.000Z',
    })

    expect(mocks.safeLogMeta).toHaveBeenCalledWith({
      kind: 'IN_PROGRESS_NO_RECENT_ACTIVITY',
      bookingId: 'booking_progress_1',
      professionalId: 'pro_2',
      clientId: 'client_2',
      sessionStep: SessionStep.BEFORE_PHOTOS,
      startedAt: '2026-04-12T01:00:00.000Z',
      lastUpdatedAt: '2026-04-12T02:30:00.000Z',
      idleHours: 40,
      thresholdHours: 12,
      scannedAt: '2026-04-13T18:30:00.000Z',
    })

    expect(warnSpy).toHaveBeenCalledTimes(2)

    const firstWarnArg = warnSpy.mock.calls[0]?.[0]
    expect(typeof firstWarnArg).toBe('string')
    expect(JSON.parse(String(firstWarnArg))).toEqual({
      level: 'warn',
      app: 'tovis',
      namespace: 'booking',
      event: 'stale_session_observed',
      kind: 'PENDING_NOT_ACCEPTED',
      bookingId: 'booking_pending_1',
      professionalId: 'pro_1',
      clientId: 'client_1',
      createdAt: '2026-04-10T18:30:00.000Z',
      scheduledFor: '2026-04-15T18:30:00.000Z',
      ageHours: 72,
      thresholdHours: 48,
      scannedAt: '2026-04-13T18:30:00.000Z',
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedAt: '2026-04-13T18:30:00.000Z',
      stalePendingHours: 48,
      staleInProgressHours: 12,
      stalePendingObserved: 1,
      staleInProgressObserved: 1,
      capped: 500,
    })

    warnSpy.mockRestore()
  })

  it('GET accepts x-internal-job-secret and custom stale thresholds', async () => {
    process.env.STALE_PENDING_HOURS = '24'
    process.env.STALE_IN_PROGRESS_HOURS = '6'

    mocks.bookingFindMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await GET(
      makeRequest({
        internalSecret: 'job_secret_1',
      }),
    )

    expect(mocks.bookingFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: BookingStatus.PENDING,
          createdAt: {
            lte: new Date('2026-04-12T18:30:00.000Z'),
          },
        },
      }),
    )

    expect(mocks.bookingFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          status: BookingStatus.IN_PROGRESS,
          updatedAt: {
            lte: new Date('2026-04-13T12:30:00.000Z'),
          },
        },
      }),
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedAt: '2026-04-13T18:30:00.000Z',
      stalePendingHours: 24,
      staleInProgressHours: 6,
      stalePendingObserved: 0,
      staleInProgressObserved: 0,
      capped: 500,
    })
  })

  it('POST runs the same job path', async () => {
    const result = await POST(
      makeRequest({
        method: 'POST',
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      scannedAt: '2026-04-13T18:30:00.000Z',
      stalePendingHours: 48,
      staleInProgressHours: 12,
      stalePendingObserved: 0,
      staleInProgressObserved: 0,
      capped: 500,
    })

    expect(mocks.bookingFindMany).toHaveBeenCalledTimes(2)
  })

  it('logs safe error metadata, captures exception, and returns 500 when scan fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const thrown = new Error(
      'db failed for tori@example.com token secret_123',
    )

    mocks.bookingFindMany.mockReset().mockRejectedValueOnce(thrown)

    const result = await GET(
      makeRequest({
        authorization: 'Bearer job_secret_1',
      }),
    )

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)

    expect(errorSpy).toHaveBeenCalledWith(
      'GET /api/internal/jobs/stale-sessions error',
      {
        error: {
          name: 'Error',
          message: 'db failed for tori@example.com token secret_123',
        },
      },
    )

    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: thrown,
      route: 'GET /api/internal/jobs/stale-sessions',
      event: 'STALE_SESSIONS_SCAN_ERROR',
    })

    errorSpy.mockRestore()
  })
})