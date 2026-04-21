import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LooksSocialJobType } from '@prisma/client'

import type { LooksSocialJobPerTypeCounts } from '@/lib/jobs/looksSocial/contracts'

import { logLooksSocialJobBatchEvent } from './looksSocialJobEvents'

function makePerTypeCounts(): LooksSocialJobPerTypeCounts {
  return {
    [LooksSocialJobType.RECOMPUTE_LOOK_COUNTS]: {
      scannedCount: 2,
      processedCount: 2,
      completedCount: 1,
      retryScheduledCount: 1,
      failedCount: 0,
    },
    [LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE]: {
      scannedCount: 1,
      processedCount: 1,
      completedCount: 1,
      retryScheduledCount: 0,
      failedCount: 0,
    },
    [LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE]: {
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
    },
    [LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS]: {
      scannedCount: 1,
      processedCount: 1,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 1,
    },
    [LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT]: {
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
    },
    [LooksSocialJobType.MODERATION_SCAN_LOOK_POST]: {
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
    },
    [LooksSocialJobType.MODERATION_SCAN_COMMENT]: {
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
    },
  }
}

function readLoggedJson(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1)

  const [line] = spy.mock.calls[0] ?? []
  expect(typeof line).toBe('string')

  return JSON.parse(String(line)) as Record<string, unknown>
}

describe('lib/observability/looksSocialJobEvents', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes info events to console.info as one structured JSON line', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const perTypeCounts = makePerTypeCounts()

    logLooksSocialJobBatchEvent({
      level: 'info',
      event: 'looks_social.jobs.batch.finished',
      route: 'internal.jobs.looks_social.process',
      batchId: 'batch_123',
      method: 'POST',
      take: 100,
      processedAt: '2026-04-21T18:30:00.000Z',
      durationMs: 42,
      scannedCount: 4,
      processedCount: 4,
      completedCount: 2,
      retryScheduledCount: 1,
      failedCount: 1,
      perTypeCounts,
    })

    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    const payload = readLoggedJson(infoSpy)

    expect(payload).toMatchObject({
      app: 'tovis-app',
      namespace: 'looks_social_jobs',
      level: 'info',
      event: 'looks_social.jobs.batch.finished',
      route: 'internal.jobs.looks_social.process',
      batchId: 'batch_123',
      method: 'POST',
      take: 100,
      processedAt: '2026-04-21T18:30:00.000Z',
      durationMs: 42,
      scannedCount: 4,
      processedCount: 4,
      completedCount: 2,
      retryScheduledCount: 1,
      failedCount: 1,
      perTypeCounts,
      message: null,
    })

    expect(typeof payload.ts).toBe('string')
  })

  it('writes warn events to console.warn and drops undefined meta fields', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    logLooksSocialJobBatchEvent({
      level: 'warn',
      event: 'looks_social.jobs.batch.finished',
      route: 'internal.jobs.looks_social.process',
      batchId: 'batch_warn_1',
      scannedCount: 3,
      processedCount: 2,
      completedCount: 1,
      retryScheduledCount: 1,
      failedCount: 0,
      meta: {
        traceId: 'trace_abc',
        skippedClaimCount: 1,
        ignoreMe: undefined,
      },
    })

    expect(infoSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    const payload = readLoggedJson(warnSpy)

    expect(payload).toMatchObject({
      app: 'tovis-app',
      namespace: 'looks_social_jobs',
      level: 'warn',
      event: 'looks_social.jobs.batch.finished',
      route: 'internal.jobs.looks_social.process',
      batchId: 'batch_warn_1',
      method: null,
      take: null,
      processedAt: null,
      durationMs: null,
      scannedCount: 3,
      processedCount: 2,
      completedCount: 1,
      retryScheduledCount: 1,
      failedCount: 0,
      perTypeCounts: null,
      message: null,
      traceId: 'trace_abc',
      skippedClaimCount: 1,
    })

    expect(payload).not.toHaveProperty('ignoreMe')
  })

  it('writes error events to console.error with message and extra metadata', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    logLooksSocialJobBatchEvent({
      level: 'error',
      event: 'looks_social.jobs.batch.exception',
      route: 'internal.jobs.looks_social.process',
      batchId: 'batch_error_1',
      method: 'GET',
      message: 'processor blew up',
      meta: {
        errorName: 'Error',
      },
    })

    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()

    const payload = readLoggedJson(errorSpy)

    expect(payload).toMatchObject({
      app: 'tovis-app',
      namespace: 'looks_social_jobs',
      level: 'error',
      event: 'looks_social.jobs.batch.exception',
      route: 'internal.jobs.looks_social.process',
      batchId: 'batch_error_1',
      method: 'GET',
      take: null,
      processedAt: null,
      durationMs: null,
      scannedCount: null,
      processedCount: null,
      completedCount: null,
      retryScheduledCount: null,
      failedCount: null,
      perTypeCounts: null,
      message: 'processor blew up',
      errorName: 'Error',
    })
  })
})