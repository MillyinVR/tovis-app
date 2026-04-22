import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LooksSocialJobStatus,
  LooksSocialJobType,
} from '@prisma/client'

import {
  makeEmptyLooksSocialJobPerTypeCounts,
  type LooksSocialJobBatchCounts,
  type LooksSocialJobPerTypeCounts,
} from '@/lib/jobs/looksSocial/contracts'

const RETRY_DELAY_MS = 5 * 60_000

const mocks = vi.hoisted(() => {
  return {
    prisma: {
      looksSocialJob: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    },
    processIndexLookPostDocument: vi.fn(),
    recomputeLookPostCounters: vi.fn(),
    recomputeLookPostSpotlightScore: vi.fn(),
    recomputeLookPostRankScore: vi.fn(),
    runViralRequestApprovalOrchestration: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/jobs/looksSocial/indexLookPostDocument', () => ({
  processIndexLookPostDocument: mocks.processIndexLookPostDocument,
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookPostCounters: mocks.recomputeLookPostCounters,
  recomputeLookPostSpotlightScore: mocks.recomputeLookPostSpotlightScore,
  recomputeLookPostRankScore: mocks.recomputeLookPostRankScore,
}))

vi.mock('@/lib/viralRequests/approvalOrchestrator', () => ({
  runViralRequestApprovalOrchestration:
    mocks.runViralRequestApprovalOrchestration,
}))

import { processLooksSocialJobs } from './process'

type DueJob = {
  id: string
  type: LooksSocialJobType
  payload: Record<string, unknown>
  dedupeKey: string
  runAt: Date
  attemptCount: number
  maxAttempts: number
  createdAt: Date
}

type PerTypeCountPatch = {
  type: LooksSocialJobType
  scannedCount?: number
  processedCount?: number
  completedCount?: number
  retryScheduledCount?: number
  failedCount?: number
}

function makeDueJob(overrides?: Partial<DueJob>): DueJob {
  return {
    id: overrides?.id ?? 'job_1',
    type: overrides?.type ?? LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
    payload: overrides?.payload ?? { lookPostId: 'look_1' },
    dedupeKey: overrides?.dedupeKey ?? 'look:look_1:recompute-counts',
    runAt: overrides?.runAt ?? new Date('2026-04-20T12:00:00.000Z'),
    attemptCount: overrides?.attemptCount ?? 0,
    maxAttempts: overrides?.maxAttempts ?? 5,
    createdAt:
      overrides?.createdAt ?? new Date('2026-04-20T11:00:00.000Z'),
  }
}

function applyBatchCountPatch(
  target: LooksSocialJobBatchCounts,
  patch: Omit<PerTypeCountPatch, 'type'>,
): void {
  if (patch.scannedCount !== undefined) {
    target.scannedCount = patch.scannedCount
  }
  if (patch.processedCount !== undefined) {
    target.processedCount = patch.processedCount
  }
  if (patch.completedCount !== undefined) {
    target.completedCount = patch.completedCount
  }
  if (patch.retryScheduledCount !== undefined) {
    target.retryScheduledCount = patch.retryScheduledCount
  }
  if (patch.failedCount !== undefined) {
    target.failedCount = patch.failedCount
  }
}

function makePerTypeCounts(
  ...patches: PerTypeCountPatch[]
): LooksSocialJobPerTypeCounts {
  const counts = makeEmptyLooksSocialJobPerTypeCounts()

  for (const patch of patches) {
    applyBatchCountPatch(counts[patch.type], patch)
  }

  return counts
}

function makeRetryAt(now: Date): Date {
  return new Date(now.getTime() + RETRY_DELAY_MS)
}

describe('lib/jobs/looksSocial/process', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes RECOMPUTE_LOOK_COUNTS jobs as supported work and marks them completed', async () => {
    const now = new Date('2026-04-20T15:00:00.000Z')
    const job = makeDueJob({
      id: 'job_counts_1',
      type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
      payload: { lookPostId: 'look_42' },
      dedupeKey: 'look:look_42:recompute-counts',
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.recomputeLookPostCounters.mockResolvedValue({
      likeCount: 10,
      commentCount: 4,
      saveCount: 3,
      spotlightScore: 37,
      rankScore: 30,
    })
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({
      now,
      batchSize: 25,
    })

    expect(mocks.prisma.looksSocialJob.findMany).toHaveBeenCalledWith({
      where: {
        status: LooksSocialJobStatus.PENDING,
        runAt: {
          lte: now,
        },
      },
      orderBy: [
        { runAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 25,
      select: {
        id: true,
        type: true,
        payload: true,
        dedupeKey: true,
        runAt: true,
        attemptCount: true,
        maxAttempts: true,
        createdAt: true,
      },
    })

    expect(mocks.prisma.looksSocialJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: job.id,
        status: LooksSocialJobStatus.PENDING,
        runAt: {
          lte: now,
        },
      },
      data: {
        status: LooksSocialJobStatus.PROCESSING,
        claimedAt: now,
        attemptCount: {
          increment: 1,
        },
      },
    })

    expect(mocks.recomputeLookPostCounters).toHaveBeenCalledWith(
      mocks.prisma,
      'look_42',
      { now },
    )

    expect(mocks.prisma.looksSocialJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: {
        status: LooksSocialJobStatus.COMPLETED,
        claimedAt: null,
        processedAt: now,
        failedAt: null,
        lastError: null,
      },
      select: { id: true },
    })

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 1,
      retryScheduledCount: 0,
      failedCount: 0,
      perTypeCounts: makePerTypeCounts({
        type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
        scannedCount: 1,
        processedCount: 1,
        completedCount: 1,
      }),
      outcomes: [
        {
          jobId: 'job_counts_1',
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:look_42:recompute-counts',
          result: 'COMPLETED',
        },
      ],
    })
  })

  it('processes INDEX_LOOK_POST_DOCUMENT jobs as supported work and marks them completed', async () => {
    const now = new Date('2026-04-20T18:00:00.000Z')
    const job = makeDueJob({
      id: 'job_index_1',
      type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
      payload: { lookPostId: 'look_99' },
      dedupeKey: 'look:look_99:index-document',
      attemptCount: 0,
      maxAttempts: 1,
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.processIndexLookPostDocument.mockResolvedValue({
      action: 'UPSERT',
      lookPostId: 'look_99',
      reason: 'LOOK_POST_SEARCHABLE',
      document: {
        id: 'look_99',
      },
    })
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.processIndexLookPostDocument).toHaveBeenCalledWith(
      mocks.prisma,
      {
        lookPostId: 'look_99',
      },
    )

    expect(mocks.prisma.looksSocialJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: {
        status: LooksSocialJobStatus.COMPLETED,
        claimedAt: null,
        processedAt: now,
        failedAt: null,
        lastError: null,
      },
      select: { id: true },
    })

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 1,
      retryScheduledCount: 0,
      failedCount: 0,
      perTypeCounts: makePerTypeCounts({
        type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
        scannedCount: 1,
        processedCount: 1,
        completedCount: 1,
      }),
      outcomes: [
        {
          jobId: 'job_index_1',
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          dedupeKey: 'look:look_99:index-document',
          result: 'COMPLETED',
        },
      ],
    })
  })

  it('requeues force-enqueued MODERATION_SCAN_LOOK_POST jobs when attempts remain, proving the worker still treats them as deferred', async () => {
    const now = new Date('2026-04-20T17:00:00.000Z')
    const retryAt = makeRetryAt(now)
    const job = makeDueJob({
      id: 'job_mod_look_retry',
      type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
      payload: { lookPostId: 'look_42' },
      dedupeKey: 'look:look_42:moderation-scan',
      attemptCount: 0,
      maxAttempts: 2,
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.recomputeLookPostCounters).not.toHaveBeenCalled()
    expect(mocks.processIndexLookPostDocument).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostSpotlightScore).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostRankScore).not.toHaveBeenCalled()

    expect(mocks.prisma.looksSocialJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: {
        status: LooksSocialJobStatus.PENDING,
        claimedAt: null,
        runAt: retryAt,
        lastError:
          'moderationScanLookPost is deferred until the look moderation implementation exists.',
      },
      select: { id: true },
    })

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 0,
      retryScheduledCount: 1,
      failedCount: 0,
      perTypeCounts: makePerTypeCounts({
        type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
        scannedCount: 1,
        processedCount: 1,
        retryScheduledCount: 1,
      }),
      outcomes: [
        {
          jobId: 'job_mod_look_retry',
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          dedupeKey: 'look:look_42:moderation-scan',
          result: 'RETRY_SCHEDULED',
          retryAt,
          message:
            'moderationScanLookPost is deferred until the look moderation implementation exists.',
        },
      ],
    })
  })

  it('fails force-enqueued MODERATION_SCAN_LOOK_POST jobs finally when max attempts are exhausted', async () => {
    const now = new Date('2026-04-20T17:10:00.000Z')
    const job = makeDueJob({
      id: 'job_mod_look_failed',
      type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
      payload: { lookPostId: 'look_43' },
      dedupeKey: 'look:look_43:moderation-scan',
      attemptCount: 0,
      maxAttempts: 1,
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.prisma.looksSocialJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: {
        status: LooksSocialJobStatus.FAILED,
        claimedAt: null,
        failedAt: now,
        lastError:
          'moderationScanLookPost is deferred until the look moderation implementation exists.',
      },
      select: { id: true },
    })

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 1,
      perTypeCounts: makePerTypeCounts({
        type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
        scannedCount: 1,
        processedCount: 1,
        failedCount: 1,
      }),
      outcomes: [
        {
          jobId: 'job_mod_look_failed',
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          dedupeKey: 'look:look_43:moderation-scan',
          result: 'FAILED_FINAL',
          message:
            'moderationScanLookPost is deferred until the look moderation implementation exists.',
        },
      ],
    })
  })

  it('requeues force-enqueued MODERATION_SCAN_COMMENT jobs when attempts remain, proving the worker still treats them as deferred', async () => {
    const now = new Date('2026-04-20T17:20:00.000Z')
    const retryAt = makeRetryAt(now)
    const job = makeDueJob({
      id: 'job_mod_comment_retry',
      type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
      payload: { commentId: 'comment_42' },
      dedupeKey: 'look-comment:comment_42:moderation-scan',
      attemptCount: 0,
      maxAttempts: 2,
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.recomputeLookPostCounters).not.toHaveBeenCalled()
    expect(mocks.processIndexLookPostDocument).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostSpotlightScore).not.toHaveBeenCalled()
    expect(mocks.recomputeLookPostRankScore).not.toHaveBeenCalled()

    expect(mocks.prisma.looksSocialJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: {
        status: LooksSocialJobStatus.PENDING,
        claimedAt: null,
        runAt: retryAt,
        lastError:
          'moderationScanComment is deferred until the comment moderation implementation exists.',
      },
      select: { id: true },
    })

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 0,
      retryScheduledCount: 1,
      failedCount: 0,
      perTypeCounts: makePerTypeCounts({
        type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
        scannedCount: 1,
        processedCount: 1,
        retryScheduledCount: 1,
      }),
      outcomes: [
        {
          jobId: 'job_mod_comment_retry',
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          dedupeKey: 'look-comment:comment_42:moderation-scan',
          result: 'RETRY_SCHEDULED',
          retryAt,
          message:
            'moderationScanComment is deferred until the comment moderation implementation exists.',
        },
      ],
    })
  })

  it('fails force-enqueued MODERATION_SCAN_COMMENT jobs finally when max attempts are exhausted', async () => {
    const now = new Date('2026-04-20T17:30:00.000Z')
    const job = makeDueJob({
      id: 'job_mod_comment_failed',
      type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
      payload: { commentId: 'comment_43' },
      dedupeKey: 'look-comment:comment_43:moderation-scan',
      attemptCount: 0,
      maxAttempts: 1,
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.prisma.looksSocialJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: {
        status: LooksSocialJobStatus.FAILED,
        claimedAt: null,
        failedAt: now,
        lastError:
          'moderationScanComment is deferred until the comment moderation implementation exists.',
      },
      select: { id: true },
    })

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 1,
      perTypeCounts: makePerTypeCounts({
        type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
        scannedCount: 1,
        processedCount: 1,
        failedCount: 1,
      }),
      outcomes: [
        {
          jobId: 'job_mod_comment_failed',
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          dedupeKey: 'look-comment:comment_43:moderation-scan',
          result: 'FAILED_FINAL',
          message:
            'moderationScanComment is deferred until the comment moderation implementation exists.',
        },
      ],
    })
  })

  it('skips jobs it cannot claim and still reports scanned per-type counts', async () => {
    const now = new Date('2026-04-20T19:00:00.000Z')
    const job = makeDueJob({
      id: 'job_counts_unclaimed',
      type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
      payload: { lookPostId: 'look_77' },
      dedupeKey: 'look:look_77:recompute-counts',
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 0 })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.recomputeLookPostCounters).not.toHaveBeenCalled()
    expect(mocks.prisma.looksSocialJob.update).not.toHaveBeenCalled()
    expect(mocks.processIndexLookPostDocument).not.toHaveBeenCalled()

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
      perTypeCounts: makePerTypeCounts({
        type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
        scannedCount: 1,
      }),
      outcomes: [],
    })
  })

  it('builds per-type counts across the supported-vs-deferred matrix for this step', async () => {
    const now = new Date('2026-04-20T19:15:00.000Z')
    const retryAt = makeRetryAt(now)

    const completedCountsJob = makeDueJob({
      id: 'job_counts_completed',
      type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
      payload: { lookPostId: 'look_100' },
      dedupeKey: 'look:look_100:recompute-counts',
    })

    const completedIndexJob = makeDueJob({
      id: 'job_index_completed',
      type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
      payload: { lookPostId: 'look_300' },
      dedupeKey: 'look:look_300:index-document',
      attemptCount: 0,
      maxAttempts: 1,
    })

    const retryCommentScanJob = makeDueJob({
      id: 'job_comment_retry',
      type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
      payload: { commentId: 'comment_10' },
      dedupeKey: 'look-comment:comment_10:moderation-scan',
      attemptCount: 0,
      maxAttempts: 2,
    })

    const failedLookScanJob = makeDueJob({
      id: 'job_look_scan_failed',
      type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
      payload: { lookPostId: 'look_400' },
      dedupeKey: 'look:look_400:moderation-scan',
      attemptCount: 0,
      maxAttempts: 1,
    })

    const unclaimedCountsJob = makeDueJob({
      id: 'job_counts_unclaimed',
      type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
      payload: { lookPostId: 'look_500' },
      dedupeKey: 'look:look_500:recompute-counts',
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([
      completedCountsJob,
      completedIndexJob,
      retryCommentScanJob,
      failedLookScanJob,
      unclaimedCountsJob,
    ])

    mocks.prisma.looksSocialJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    mocks.recomputeLookPostCounters.mockResolvedValue({
      likeCount: 7,
      commentCount: 2,
      saveCount: 1,
      spotlightScore: 21,
      rankScore: 15,
    })

    mocks.processIndexLookPostDocument.mockResolvedValue({
      action: 'DELETE',
      lookPostId: 'look_300',
      reason: 'LOOK_POST_NOT_SEARCHABLE',
      document: null,
    })

    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: 'updated' })

    const result = await processLooksSocialJobs({ now })

    expect(result).toEqual({
      scannedCount: 5,
      processedCount: 4,
      completedCount: 2,
      retryScheduledCount: 1,
      failedCount: 1,
      perTypeCounts: makePerTypeCounts(
        {
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          scannedCount: 2,
          processedCount: 1,
          completedCount: 1,
        },
        {
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          scannedCount: 1,
          processedCount: 1,
          completedCount: 1,
        },
        {
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          scannedCount: 1,
          processedCount: 1,
          retryScheduledCount: 1,
        },
        {
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          scannedCount: 1,
          processedCount: 1,
          failedCount: 1,
        },
      ),
      outcomes: [
        {
          jobId: 'job_counts_completed',
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:look_100:recompute-counts',
          result: 'COMPLETED',
        },
        {
          jobId: 'job_index_completed',
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          dedupeKey: 'look:look_300:index-document',
          result: 'COMPLETED',
        },
        {
          jobId: 'job_comment_retry',
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          dedupeKey: 'look-comment:comment_10:moderation-scan',
          result: 'RETRY_SCHEDULED',
          retryAt,
          message:
            'moderationScanComment is deferred until the comment moderation implementation exists.',
        },
        {
          jobId: 'job_look_scan_failed',
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          dedupeKey: 'look:look_400:moderation-scan',
          result: 'FAILED_FINAL',
          message:
            'moderationScanLookPost is deferred until the look moderation implementation exists.',
        },
      ],
    })
  })
})