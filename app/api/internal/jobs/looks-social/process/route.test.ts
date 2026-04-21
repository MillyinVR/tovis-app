import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BATCH_ID = 'batch_test_123'

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
    logLooksSocialJobBatchEvent: vi.fn(),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/jobs/looksSocial/process', () => ({
  processLooksSocialJobs: mocks.processLooksSocialJobs,
}))

vi.mock('@/lib/observability/looksSocialJobEvents', () => ({
  logLooksSocialJobBatchEvent: mocks.logLooksSocialJobBatchEvent,
}))

import { GET, POST } from './route'

function makeProcessResult(
  overrides?: Partial<{
    scannedCount: number
    processedCount: number
    completedCount: number
    retryScheduledCount: number
    failedCount: number
    perTypeCounts: Record<string, unknown>
    outcomes: unknown[]
  }>,
) {
  return {
    scannedCount: 0,
    processedCount: 0,
    completedCount: 0,
    retryScheduledCount: 0,
    failedCount: 0,
    perTypeCounts: {},
    outcomes: [],
    ...overrides,
  }
}

describe('app/api/internal/jobs/looks-social/process/route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(BATCH_ID)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('GET returns 401 when no job secret is configured', async () => {
    const req = new Request(
      'https://tovis.app/api/internal/jobs/looks-social/process',
    )

    const result = await GET(req)

    expect(mocks.jsonFail).toHaveBeenCalledWith(401, 'Unauthorized')
    expect(mocks.processLooksSocialJobs).not.toHaveBeenCalled()
    expect(mocks.logLooksSocialJobBatchEvent).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Unauthorized',
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
    expect(mocks.logLooksSocialJobBatchEvent).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 401,
      message: 'Unauthorized',
    })
  })

  it('GET accepts Bearer authorization, passes bounded take + now to the processor, and logs started + warn finished events', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'secret_123')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T10:15:00.000Z'))

    const perTypeCounts = {
      RECOMPUTE_LOOK_COUNTS: {
        scannedCount: 2,
        processedCount: 2,
        completedCount: 2,
        retryScheduledCount: 0,
        failedCount: 0,
      },
      MODERATION_SCAN_COMMENT: {
        scannedCount: 1,
        processedCount: 1,
        completedCount: 0,
        retryScheduledCount: 1,
        failedCount: 0,
      },
    }

    mocks.processLooksSocialJobs.mockResolvedValue(
      makeProcessResult({
        scannedCount: 3,
        processedCount: 3,
        completedCount: 2,
        retryScheduledCount: 1,
        failedCount: 0,
        perTypeCounts,
        outcomes: [],
      }),
    )

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

    expect(mocks.logLooksSocialJobBatchEvent).toHaveBeenNthCalledWith(1, {
      level: 'info',
      event: 'looks_social.jobs.batch.started',
      route: 'internal.jobs.looks_social.process',
      batchId: BATCH_ID,
      method: 'GET',
      take: 250,
    })

    expect(mocks.logLooksSocialJobBatchEvent).toHaveBeenNthCalledWith(2, {
      level: 'warn',
      event: 'looks_social.jobs.batch.finished',
      route: 'internal.jobs.looks_social.process',
      batchId: BATCH_ID,
      method: 'GET',
      take: 250,
      processedAt: '2026-04-20T10:15:00.000Z',
      durationMs: 0,
      scannedCount: 3,
      processedCount: 3,
      completedCount: 2,
      retryScheduledCount: 1,
      failedCount: 0,
      perTypeCounts,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith({
      scannedCount: 3,
      processedCount: 3,
      completedCount: 2,
      retryScheduledCount: 1,
      failedCount: 0,
      perTypeCounts,
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
        perTypeCounts,
        outcomes: [],
        take: 250,
        processedAt: '2026-04-20T10:15:00.000Z',
      },
    })
  })

  it('POST accepts x-internal-job-secret, uses the default take when the query is invalid, and logs an info finished event for a clean batch', async () => {
    vi.stubEnv('CRON_SECRET', 'cron_456')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T11:45:00.000Z'))

    const perTypeCounts = {
      RECOMPUTE_LOOK_COUNTS: {
        scannedCount: 0,
        processedCount: 0,
        completedCount: 0,
        retryScheduledCount: 0,
        failedCount: 0,
      },
    }

    mocks.processLooksSocialJobs.mockResolvedValue(
      makeProcessResult({
        scannedCount: 0,
        processedCount: 0,
        completedCount: 0,
        retryScheduledCount: 0,
        failedCount: 0,
        perTypeCounts,
        outcomes: [],
      }),
    )

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

    expect(mocks.logLooksSocialJobBatchEvent).toHaveBeenNthCalledWith(1, {
      level: 'info',
      event: 'looks_social.jobs.batch.started',
      route: 'internal.jobs.looks_social.process',
      batchId: BATCH_ID,
      method: 'POST',
      take: 100,
    })

    expect(mocks.logLooksSocialJobBatchEvent).toHaveBeenNthCalledWith(2, {
      level: 'info',
      event: 'looks_social.jobs.batch.finished',
      route: 'internal.jobs.looks_social.process',
      batchId: BATCH_ID,
      method: 'POST',
      take: 100,
      processedAt: '2026-04-20T11:45:00.000Z',
      durationMs: 0,
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
      perTypeCounts,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith({
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
      perTypeCounts,
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
        perTypeCounts,
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

    mocks.processLooksSocialJobs.mockResolvedValue(
      makeProcessResult({
        scannedCount: 1,
        processedCount: 1,
        completedCount: 1,
      }),
    )

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

  it('GET returns 500 with the thrown error message and logs a structured exception event when processing fails', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'secret_123')
    mocks.processLooksSocialJobs.mockRejectedValue(
      new Error('processor blew up'),
    )

    const req = new Request(
      'https://tovis.app/api/internal/jobs/looks-social/process',
      {
        headers: {
          authorization: 'Bearer secret_123',
        },
      },
    )

    const result = await GET(req)

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'processor blew up')

    expect(mocks.logLooksSocialJobBatchEvent).toHaveBeenNthCalledWith(1, {
      level: 'info',
      event: 'looks_social.jobs.batch.started',
      route: 'internal.jobs.looks_social.process',
      batchId: BATCH_ID,
      method: 'GET',
      take: 100,
    })

    expect(mocks.logLooksSocialJobBatchEvent).toHaveBeenNthCalledWith(2, {
      level: 'error',
      event: 'looks_social.jobs.batch.exception',
      route: 'internal.jobs.looks_social.process',
      batchId: BATCH_ID,
      method: 'GET',
      message: 'processor blew up',
      meta: {
        errorName: 'Error',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      message: 'processor blew up',
    })
  })

  it('POST returns 500 with a generic message for non-Error throws and logs a structured exception event', async () => {
    vi.stubEnv('INTERNAL_JOB_SECRET', 'secret_123')
    mocks.processLooksSocialJobs.mockRejectedValue('boom')

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

    expect(mocks.logLooksSocialJobBatchEvent).toHaveBeenNthCalledWith(1, {
      level: 'info',
      event: 'looks_social.jobs.batch.started',
      route: 'internal.jobs.looks_social.process',
      batchId: BATCH_ID,
      method: 'POST',
      take: 100,
    })

    expect(mocks.logLooksSocialJobBatchEvent).toHaveBeenNthCalledWith(2, {
      level: 'error',
      event: 'looks_social.jobs.batch.exception',
      route: 'internal.jobs.looks_social.process',
      batchId: BATCH_ID,
      method: 'POST',
      message: 'Internal server error',
      meta: {
        errorName: 'NonErrorThrown',
      },
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      message: 'Internal server error',
    })
  })
})