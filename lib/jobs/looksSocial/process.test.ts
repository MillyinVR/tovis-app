import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LooksSocialJobStatus,
  LooksSocialJobType,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  return {
    prisma: {
      looksSocialJob: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    },
    recomputeLookPostCounters: vi.fn(),
    recomputeLookPostSpotlightScore: vi.fn(),
    recomputeLookPostRankScore: vi.fn(),
    enqueueViralRequestApprovalNotifications: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/looks/counters', () => ({
  recomputeLookPostCounters: mocks.recomputeLookPostCounters,
  recomputeLookPostSpotlightScore: mocks.recomputeLookPostSpotlightScore,
  recomputeLookPostRankScore: mocks.recomputeLookPostRankScore,
}))

vi.mock('@/lib/viralRequests', () => ({
  enqueueViralRequestApprovalNotifications:
    mocks.enqueueViralRequestApprovalNotifications,
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

function makeDueJob(overrides?: Partial<DueJob>): DueJob {
  return {
    id: overrides?.id ?? 'job_1',
    type:
      overrides?.type ?? LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
    payload: overrides?.payload ?? { lookPostId: 'look_1' },
    dedupeKey:
      overrides?.dedupeKey ?? 'look:look_1:recompute-counts',
    runAt:
      overrides?.runAt ?? new Date('2026-04-20T12:00:00.000Z'),
    attemptCount: overrides?.attemptCount ?? 0,
    maxAttempts: overrides?.maxAttempts ?? 5,
    createdAt:
      overrides?.createdAt ?? new Date('2026-04-20T11:00:00.000Z'),
  }
}

describe('lib/jobs/looksSocial/process', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes recompute look counts jobs and marks them completed', async () => {
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

  it('processes spotlight score jobs and marks them completed', async () => {
    const now = new Date('2026-04-20T15:30:00.000Z')
    const job = makeDueJob({
      id: 'job_spotlight_1',
      type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
      payload: { lookPostId: 'look_52' },
      dedupeKey: 'look:look_52:recompute-spotlight-score',
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.recomputeLookPostSpotlightScore.mockResolvedValue(123)
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.recomputeLookPostSpotlightScore).toHaveBeenCalledWith(
      mocks.prisma,
      'look_52',
      { now },
    )

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 1,
      retryScheduledCount: 0,
      failedCount: 0,
      outcomes: [
        {
          jobId: 'job_spotlight_1',
          type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
          dedupeKey: 'look:look_52:recompute-spotlight-score',
          result: 'COMPLETED',
        },
      ],
    })
  })

  it('processes rank score jobs and marks them completed', async () => {
    const now = new Date('2026-04-20T15:45:00.000Z')
    const job = makeDueJob({
      id: 'job_rank_1',
      type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
      payload: { lookPostId: 'look_53' },
      dedupeKey: 'look:look_53:recompute-rank-score',
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.recomputeLookPostRankScore.mockResolvedValue(91)
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.recomputeLookPostRankScore).toHaveBeenCalledWith(
      mocks.prisma,
      'look_53',
      { now },
    )

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 1,
      retryScheduledCount: 0,
      failedCount: 0,
      outcomes: [
        {
          jobId: 'job_rank_1',
          type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
          dedupeKey: 'look:look_53:recompute-rank-score',
          result: 'COMPLETED',
        },
      ],
    })
  })

  it('processes viral fan-out jobs and marks them completed', async () => {
    const now = new Date('2026-04-20T16:00:00.000Z')
    const job = makeDueJob({
      id: 'job_viral_1',
      type:
        LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS,
      payload: { requestId: 'request_7' },
      dedupeKey:
        'viral-request:request_7:fan-out-approval-notifications',
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.enqueueViralRequestApprovalNotifications.mockResolvedValue({
      enqueued: true,
      matchedProfessionalIds: ['pro_1', 'pro_2'],
      dispatchSourceKeys: [
        'viral-request:request_7:professional:pro_1:approved',
        'viral-request:request_7:professional:pro_2:approved',
      ],
    })
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).toHaveBeenCalledWith(mocks.prisma, {
      requestId: 'request_7',
    })

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 1,
      retryScheduledCount: 0,
      failedCount: 0,
      outcomes: [
        {
          jobId: 'job_viral_1',
          type:
            LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS,
          dedupeKey:
            'viral-request:request_7:fan-out-approval-notifications',
          result: 'COMPLETED',
        },
      ],
    })
  })

  it('requeues deferred moderation scan comment jobs when attempts remain', async () => {
    const now = new Date('2026-04-20T17:00:00.000Z')
    const retryAt = new Date('2026-04-20T17:05:00.000Z')
    const job = makeDueJob({
      id: 'job_mod_comment_1',
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
    expect(
      mocks.enqueueViralRequestApprovalNotifications,
    ).not.toHaveBeenCalled()

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
      outcomes: [
        {
          jobId: 'job_mod_comment_1',
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

  it('marks deferred index jobs failed when max attempts are exhausted', async () => {
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
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.prisma.looksSocialJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: {
        status: LooksSocialJobStatus.FAILED,
        claimedAt: null,
        failedAt: now,
        lastError:
          'indexLookPostDocument is deferred until the search indexing implementation exists.',
      },
      select: { id: true },
    })

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 1,
      outcomes: [
        {
          jobId: 'job_index_1',
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          dedupeKey: 'look:look_99:index-document',
          result: 'FAILED_FINAL',
          message:
            'indexLookPostDocument is deferred until the search indexing implementation exists.',
        },
      ],
    })
  })

  it('fails finally when a job payload field is missing and max attempts are exhausted', async () => {
    const now = new Date('2026-04-20T18:30:00.000Z')
    const job = makeDueJob({
      id: 'job_bad_payload_1',
      type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
      payload: {},
      dedupeKey: 'look:missing:recompute-counts',
      attemptCount: 0,
      maxAttempts: 1,
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.looksSocialJob.update.mockResolvedValue({ id: job.id })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.recomputeLookPostCounters).not.toHaveBeenCalled()

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 1,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 1,
      outcomes: [
        {
          jobId: 'job_bad_payload_1',
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:missing:recompute-counts',
          result: 'FAILED_FINAL',
          message: 'Job payload field lookPostId must be a string.',
        },
      ],
    })
  })

  it('skips jobs it cannot claim', async () => {
    const now = new Date('2026-04-20T19:00:00.000Z')
    const job = makeDueJob({
      id: 'job_counts_2',
      type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
      payload: { lookPostId: 'look_77' },
      dedupeKey: 'look:look_77:recompute-counts',
    })

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([job])
    mocks.prisma.looksSocialJob.updateMany.mockResolvedValue({ count: 0 })

    const result = await processLooksSocialJobs({ now })

    expect(mocks.recomputeLookPostCounters).not.toHaveBeenCalled()
    expect(mocks.prisma.looksSocialJob.update).not.toHaveBeenCalled()

    expect(result).toEqual({
      scannedCount: 1,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
      outcomes: [],
    })
  })

  it('uses the default batch size when batchSize is omitted', async () => {
    const now = new Date('2026-04-20T19:30:00.000Z')

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([])

    const result = await processLooksSocialJobs({ now })

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
      take: 100,
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

    expect(result).toEqual({
      scannedCount: 0,
      processedCount: 0,
      completedCount: 0,
      retryScheduledCount: 0,
      failedCount: 0,
      outcomes: [],
    })
  })

  it('normalizes an oversized batch size down to the max', async () => {
    const now = new Date('2026-04-20T19:45:00.000Z')

    mocks.prisma.looksSocialJob.findMany.mockResolvedValue([])

    await processLooksSocialJobs({
      now,
      batchSize: 999,
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
      take: 250,
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
  })
})