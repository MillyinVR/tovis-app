import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    jsonOk: vi.fn((body: unknown) => ({
      ok: true,
      status: 200,
      body,
    })),
    jsonFail: vi.fn((status: number, message: string) => ({
      ok: false,
      status,
      message,
    })),
    processLooksSocialJobs: vi.fn(),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/jobs/looksSocial/process', () => ({
  processLooksSocialJobs: mocks.processLooksSocialJobs,
}))

import { GET, POST } from './route'

describe('app/api/internal/jobs/looks-social/process/route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('GET returns 500 when no job secret is configured', async () => {
    const req = new Request(
      'https://tovis.app/api/internal/jobs/looks-social/process',
    )

    const result = await GET(req)

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
    expect(mocks.processLooksSocialJobs).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 500,
      message: 'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    })
  })

  it('POST returns 401 when authorization is missing', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'secret_123')

    const req = new Request(
      'https://tovis.app/api/internal/jobs/looks-social/process',
      {
        method: 'POST',
      },
    )

    const result = await POST(req)

    expect(mocks.jsonFail).toHaveBeenCalledWith(401, 'Unauthorized')
    expect(mocks.processLooksSocialJobs).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Unauthorized',
    })
  })

  it('GET accepts Bearer authorization and passes bounded take + now to the processor', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'secret_123')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T10:15:00.000Z'))

    mocks.processLooksSocialJobs.mockResolvedValue({
      scannedCount: 3,
      processedCount: 3,
      completedCount: 2,
      retryScheduledCount: 1,
      failedCount: 0,
      outcomes: [],
    })

    const req = new Request(
      'https://tovis.app/api/internal/jobs/looks-social/process?take=999',
      {
        headers: {
          authorization: 'Bearer secret_123',
        },
      },
    )

    const result = await GET(req)

    expect(mocks.processLooksSocialJobs).toHaveBeenCalledWith({
      now: new Date('2026-04-20T10:15:00.000Z'),
      batchSize: 250,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith({
      scannedCount: 3,
      processedCount: 3,
      completedCount: 2,
      retryScheduledCount: 1,
      failedCount: 0,
      outcomes: [],
      take: 250,
      processedAt: '2026-04-20T10:15:00.000Z',
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        scannedCount: 3,
        processedCount: 3,
        completedCount: 2,
        retryScheduledCount: 1,
        failedCount: 0,
        outcomes: [],
        take: 250,
        processedAt: '2026-04-20T10:15:00.000Z',
      },
    })
  })

  it('POST accepts x-internal-job-secret and uses the default take when the query is invalid', async () => {
    vi.stubEnv('CRON_SECRET', 'cron_456')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T11:45:00.000Z'))

    mocks.processLooksSocialJobs.mockResolvedValue({
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
      outcomes: [],
    })

    const req = new Request(
      'https://tovis.app/api/internal/jobs/looks-social/process?take=not-a-number',
      {
        method: 'POST',
        headers: {
          'x-internal-job-secret': 'cron_456',
        },
      },
    )

    const result = await POST(req)

    expect(mocks.processLooksSocialJobs).toHaveBeenCalledWith({
      now: new Date('2026-04-20T11:45:00.000Z'),
      batchSize: 100,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith({
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
      outcomes: [],
      take: 100,
      processedAt: '2026-04-20T11:45:00.000Z',
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: {
        scannedCount: 0,
        processedCount: 0,
        completedCount: 0,
        retryScheduledCount: 0,
        failedCount: 0,
        outcomes: [],
        take: 100,
        processedAt: '2026-04-20T11:45:00.000Z',
      },
    })
  })

  it('clamps take to a minimum of 1', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'secret_123')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T12:00:00.000Z'))

    mocks.processLooksSocialJobs.mockResolvedValue({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 1,
      retryScheduledCount: 0,
      failedCount: 0,
      outcomes: [],
    })

    const req = new Request(
      'https://tovis.app/api/internal/jobs/looks-social/process?take=0',
      {
        headers: {
          authorization: 'Bearer secret_123',
        },
      },
    )

    await GET(req)

    expect(mocks.processLooksSocialJobs).toHaveBeenCalledWith({
      now: new Date('2026-04-20T12:00:00.000Z'),
      batchSize: 1,
    })
  })

  it('GET returns 500 with the thrown error message when processing fails', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'secret_123')
    mocks.processLooksSocialJobs.mockRejectedValue(
      new Error('processor blew up'),
    )

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const req = new Request(
        'https://tovis.app/api/internal/jobs/looks-social/process',
        {
          headers: {
            authorization: 'Bearer secret_123',
          },
        },
      )

      const result = await GET(req)

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        500,
        'processor blew up',
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'GET /api/internal/jobs/looks-social/process error',
        expect.any(Error),
      )
      expect(result).toEqual({
        ok: false,
        status: 500,
        message: 'processor blew up',
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('POST returns 500 with a generic message for non-Error throws', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'secret_123')
    mocks.processLooksSocialJobs.mockRejectedValue('boom')

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const req = new Request(
        'https://tovis.app/api/internal/jobs/looks-social/process',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer secret_123',
          },
        },
      )

      const result = await POST(req)

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        500,
        'Internal server error',
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'POST /api/internal/jobs/looks-social/process error',
        'boom',
      )
      expect(result).toEqual({
        ok: false,
        status: 500,
        message: 'Internal server error',
      })
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})