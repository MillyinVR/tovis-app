import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LooksSocialJobStatus,
  LooksSocialJobType,
  PrismaClient,
} from '@prisma/client'

import {
  enqueueFanOutViralRequestApprovalNotifications,
  enqueueIndexLookPostDocument,
  enqueueLooksSocialJob,
  enqueueModerationScanComment,
  enqueueModerationScanLookPost,
  enqueueRecomputeLookCounts,
  enqueueRecomputeLookRankScore,
  enqueueRecomputeLookSpotlightScore,
} from './enqueue'

function makeDb() {
  return {
    looksSocialJob: {
      upsert: vi.fn(),
    },
  }
}

/**
 * Narrow local test-only cast:
 * production helpers accept PrismaClient | Prisma.TransactionClient,
 * but these unit tests only mock the members exercised by jobs/looksSocial/enqueue.ts.
 */
function asLooksSocialJobDb(
  value: ReturnType<typeof makeDb>,
): PrismaClient {
  return value as unknown as PrismaClient
}

function makeJobRow(
  overrides?: Partial<{
    id: string
    type: LooksSocialJobType
    dedupeKey: string
    status: LooksSocialJobStatus
    runAt: Date
    attemptCount: number
    maxAttempts: number
  }>,
) {
  return {
    id: overrides?.id ?? 'job_1',
    type: overrides?.type ?? LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
    dedupeKey:
      overrides?.dedupeKey ?? 'look:look_1:recompute-counts',
    status: overrides?.status ?? LooksSocialJobStatus.PENDING,
    runAt:
      overrides?.runAt ?? new Date('2026-04-20T12:00:00.000Z'),
    attemptCount: overrides?.attemptCount ?? 0,
    maxAttempts: overrides?.maxAttempts ?? 5,
  }
}

describe('lib/jobs/looksSocial/enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('enqueueLooksSocialJob', () => {
    it('upserts a normalized job row and resets retry state', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)
      const runAt = new Date('2026-04-21T09:30:00.000Z')

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_counts_1',
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:look_1:recompute-counts',
          runAt,
          maxAttempts: 7,
        }),
      )

      const result = await enqueueLooksSocialJob(prismaDb, {
        type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
        dedupeKey: ' look:look_1:recompute-counts ',
        payload: {
          lookPostId: 'look_1',
        },
        runAt,
        maxAttempts: 7,
      })

      expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
        where: {
          dedupeKey: 'look:look_1:recompute-counts',
        },
        update: {
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          payload: {
            lookPostId: 'look_1',
          },
          status: LooksSocialJobStatus.PENDING,
          runAt,
          claimedAt: null,
          processedAt: null,
          failedAt: null,
          attemptCount: 0,
          maxAttempts: 7,
          lastError: null,
        },
        create: {
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:look_1:recompute-counts',
          payload: {
            lookPostId: 'look_1',
          },
          status: LooksSocialJobStatus.PENDING,
          runAt,
          maxAttempts: 7,
        },
        select: {
          id: true,
          type: true,
          dedupeKey: true,
          status: true,
          runAt: true,
          attemptCount: true,
          maxAttempts: true,
        },
      })

      expect(result).toEqual(
        makeJobRow({
          id: 'job_counts_1',
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:look_1:recompute-counts',
          runAt,
          maxAttempts: 7,
        }),
      )
    })

    it('defaults runAt to now and maxAttempts to 5', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-20T15:00:00.000Z'))

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_default_1',
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          dedupeKey: 'look-comment:comment_1:moderation-scan',
          runAt: new Date('2026-04-20T15:00:00.000Z'),
          maxAttempts: 5,
        }),
      )

      try {
        await enqueueLooksSocialJob(prismaDb, {
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          dedupeKey: 'look-comment:comment_1:moderation-scan',
          payload: {
            commentId: 'comment_1',
          },
        })

        expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
          where: {
            dedupeKey: 'look-comment:comment_1:moderation-scan',
          },
          update: expect.objectContaining({
            runAt: new Date('2026-04-20T15:00:00.000Z'),
            maxAttempts: 5,
          }),
          create: expect.objectContaining({
            runAt: new Date('2026-04-20T15:00:00.000Z'),
            maxAttempts: 5,
          }),
          select: expect.any(Object),
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('throws when dedupeKey is blank', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      await expect(
        enqueueLooksSocialJob(prismaDb, {
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: '   ',
          payload: {
            lookPostId: 'look_1',
          },
        }),
      ).rejects.toThrow('dedupeKey is required.')

      expect(db.looksSocialJob.upsert).not.toHaveBeenCalled()
    })

    it('throws when maxAttempts is not finite', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      await expect(
        enqueueLooksSocialJob(prismaDb, {
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:look_1:recompute-counts',
          payload: {
            lookPostId: 'look_1',
          },
          maxAttempts: Number.NaN,
        }),
      ).rejects.toThrow('maxAttempts must be a finite number.')

      expect(db.looksSocialJob.upsert).not.toHaveBeenCalled()
    })
  })

  describe('typed wrapper helpers', () => {
    it('enqueueRecomputeLookCounts builds the canonical dedupe key and payload', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_counts_2',
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:look_42:recompute-counts',
        }),
      )

      const result = await enqueueRecomputeLookCounts(prismaDb, {
        lookPostId: ' look_42 ',
      })

      expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
        where: {
          dedupeKey: 'look:look_42:recompute-counts',
        },
        update: expect.objectContaining({
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          payload: {
            lookPostId: 'look_42',
          },
        }),
        create: expect.objectContaining({
          type: LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
          dedupeKey: 'look:look_42:recompute-counts',
          payload: {
            lookPostId: 'look_42',
          },
        }),
        select: expect.any(Object),
      })

      expect(result.type).toBe(
        LooksSocialJobType.RECOMPUTE_LOOK_COUNTS,
      )
      expect(result.dedupeKey).toBe(
        'look:look_42:recompute-counts',
      )
    })

    it('enqueueRecomputeLookSpotlightScore builds the canonical dedupe key and payload', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_spotlight_1',
          type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
          dedupeKey: 'look:look_42:recompute-spotlight-score',
        }),
      )

      await enqueueRecomputeLookSpotlightScore(prismaDb, {
        lookPostId: 'look_42',
      })

      expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
        where: {
          dedupeKey: 'look:look_42:recompute-spotlight-score',
        },
        update: expect.objectContaining({
          type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
          payload: {
            lookPostId: 'look_42',
          },
        }),
        create: expect.objectContaining({
          type: LooksSocialJobType.RECOMPUTE_LOOK_SPOTLIGHT_SCORE,
          dedupeKey: 'look:look_42:recompute-spotlight-score',
          payload: {
            lookPostId: 'look_42',
          },
        }),
        select: expect.any(Object),
      })
    })

    it('enqueueRecomputeLookRankScore builds the canonical dedupe key and payload', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_rank_1',
          type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
          dedupeKey: 'look:look_42:recompute-rank-score',
        }),
      )

      await enqueueRecomputeLookRankScore(prismaDb, {
        lookPostId: 'look_42',
      })

      expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
        where: {
          dedupeKey: 'look:look_42:recompute-rank-score',
        },
        update: expect.objectContaining({
          type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
          payload: {
            lookPostId: 'look_42',
          },
        }),
        create: expect.objectContaining({
          type: LooksSocialJobType.RECOMPUTE_LOOK_RANK_SCORE,
          dedupeKey: 'look:look_42:recompute-rank-score',
          payload: {
            lookPostId: 'look_42',
          },
        }),
        select: expect.any(Object),
      })
    })

    it('enqueueFanOutViralRequestApprovalNotifications builds the canonical dedupe key and payload', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_viral_1',
          type:
            LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS,
          dedupeKey:
            'viral-request:request_7:fan-out-approval-notifications',
        }),
      )

      await enqueueFanOutViralRequestApprovalNotifications(prismaDb, {
        requestId: ' request_7 ',
      })

      expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
        where: {
          dedupeKey:
            'viral-request:request_7:fan-out-approval-notifications',
        },
        update: expect.objectContaining({
          type:
            LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS,
          payload: {
            requestId: 'request_7',
          },
        }),
        create: expect.objectContaining({
          type:
            LooksSocialJobType.FAN_OUT_VIRAL_REQUEST_APPROVAL_NOTIFICATIONS,
          dedupeKey:
            'viral-request:request_7:fan-out-approval-notifications',
          payload: {
            requestId: 'request_7',
          },
        }),
        select: expect.any(Object),
      })
    })

    it('enqueueIndexLookPostDocument builds the canonical dedupe key and payload', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_index_1',
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          dedupeKey: 'look:look_42:index-document',
        }),
      )

      await enqueueIndexLookPostDocument(prismaDb, {
        lookPostId: 'look_42',
      })

      expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
        where: {
          dedupeKey: 'look:look_42:index-document',
        },
        update: expect.objectContaining({
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          payload: {
            lookPostId: 'look_42',
          },
        }),
        create: expect.objectContaining({
          type: LooksSocialJobType.INDEX_LOOK_POST_DOCUMENT,
          dedupeKey: 'look:look_42:index-document',
          payload: {
            lookPostId: 'look_42',
          },
        }),
        select: expect.any(Object),
      })
    })

    it('enqueueModerationScanLookPost builds the canonical dedupe key and payload', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_mod_look_1',
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          dedupeKey: 'look:look_42:moderation-scan',
        }),
      )

      await enqueueModerationScanLookPost(prismaDb, {
        lookPostId: 'look_42',
      })

      expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
        where: {
          dedupeKey: 'look:look_42:moderation-scan',
        },
        update: expect.objectContaining({
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          payload: {
            lookPostId: 'look_42',
          },
        }),
        create: expect.objectContaining({
          type: LooksSocialJobType.MODERATION_SCAN_LOOK_POST,
          dedupeKey: 'look:look_42:moderation-scan',
          payload: {
            lookPostId: 'look_42',
          },
        }),
        select: expect.any(Object),
      })
    })

    it('enqueueModerationScanComment builds the canonical dedupe key and payload', async () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      db.looksSocialJob.upsert.mockResolvedValue(
        makeJobRow({
          id: 'job_mod_comment_1',
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          dedupeKey: 'look-comment:comment_42:moderation-scan',
        }),
      )

      await enqueueModerationScanComment(prismaDb, {
        commentId: ' comment_42 ',
      })

      expect(db.looksSocialJob.upsert).toHaveBeenCalledWith({
        where: {
          dedupeKey: 'look-comment:comment_42:moderation-scan',
        },
        update: expect.objectContaining({
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          payload: {
            commentId: 'comment_42',
          },
        }),
        create: expect.objectContaining({
          type: LooksSocialJobType.MODERATION_SCAN_COMMENT,
          dedupeKey: 'look-comment:comment_42:moderation-scan',
          payload: {
            commentId: 'comment_42',
          },
        }),
        select: expect.any(Object),
      })
    })

    it('throws when a wrapper payload id is blank', () => {
      const db = makeDb()
      const prismaDb = asLooksSocialJobDb(db)

      expect(() =>
        enqueueModerationScanComment(prismaDb, {
          commentId: '   ',
        }),
      ).toThrow('commentId is required.')

      expect(db.looksSocialJob.upsert).not.toHaveBeenCalled()
    })
  })
})