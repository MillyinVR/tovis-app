// lib/looks/counters.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

import {
  computeLookPostRankScore,
  computeLookPostSpotlightScore,
  recomputeLookCommentLikeCount,
  recomputeLookCommentReplyCount,
  recomputeLookPostCommentCount,
  recomputeLookPostCounters,
  recomputeLookPostLikeCount,
  recomputeLookPostRankScore,
  recomputeLookPostSaveCount,
  recomputeLookPostScores,
  recomputeLookPostSpotlightScore,
} from './counters'

function makeScoreEligibleLookRow(overrides?: {
  status?: LookPostStatus
  moderationStatus?: ModerationStatus
  publishedAt?: Date | null
  likeCount?: number
  commentCount?: number
  saveCount?: number
  shareCount?: number
  viewCount?: number
}) {
  return {
    id: 'look_1',
    status: overrides?.status ?? LookPostStatus.PUBLISHED,
    moderationStatus:
      overrides?.moderationStatus ?? ModerationStatus.APPROVED,
    publishedAt:
      overrides && 'publishedAt' in overrides
        ? overrides.publishedAt ?? null
        : new Date('2026-04-19T00:00:00.000Z'),
    likeCount: overrides?.likeCount ?? 0,
    commentCount: overrides?.commentCount ?? 0,
    saveCount: overrides?.saveCount ?? 0,
    shareCount: overrides?.shareCount ?? 0,
    viewCount: overrides?.viewCount ?? 0,
  }
}

function makeDb() {
  return {
    lookPost: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    lookLike: {
      count: vi.fn(),
    },
    lookComment: {
      count: vi.fn(),
      update: vi.fn(),
    },
    lookCommentLike: {
      count: vi.fn(),
    },
    boardItem: {
      count: vi.fn(),
    },
    lookCategoryRankStat: {
      findUnique: vi.fn(),
    },
  }
}

/**
 * Narrow local test-only cast:
 * production helpers accept Prisma.TransactionClient | PrismaClient,
 * but these unit tests only mock the members exercised by counters.ts.
 */
function asTransactionClient(
  value: ReturnType<typeof makeDb>,
): Prisma.TransactionClient {
  return value as unknown as Prisma.TransactionClient
}

describe('lib/looks/counters.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('computeLookPostSpotlightScore', () => {
    it('returns 0 for non-published looks', () => {
      const result = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          status: LookPostStatus.DRAFT,
          likeCount: 10,
          commentCount: 4,
          saveCount: 2,
          shareCount: 1,
        }),
      )

      expect(result).toBe(0)
    })

    it('returns 0 for non-approved looks', () => {
      const result = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          moderationStatus: ModerationStatus.PENDING_REVIEW,
          likeCount: 10,
          commentCount: 4,
          saveCount: 2,
          shareCount: 1,
        }),
      )

      expect(result).toBe(0)
    })

    it('returns 0 when publishedAt is null', () => {
      const result = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          publishedAt: null,
          likeCount: 10,
          commentCount: 4,
          saveCount: 2,
          shareCount: 1,
        }),
      )

      expect(result).toBe(0)
    })

    it('returns 0 below the minimum interaction threshold', () => {
      const result = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          likeCount: 2,
          commentCount: 1,
          saveCount: 1,
          shareCount: 0,
        }),
      )

      expect(result).toBe(0)
    })

    it('returns 0 when the look has no saves', () => {
      const result = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          likeCount: 4,
          commentCount: 1,
          saveCount: 0,
          shareCount: 0,
        }),
      )

      expect(result).toBe(0)
    })

    it('rewards a more save-heavy interaction mix at the same sample size', () => {
      const saveHeavy = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          likeCount: 1,
          commentCount: 1,
          saveCount: 4,
          shareCount: 0,
        }),
      )

      const likeHeavy = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          likeCount: 4,
          commentCount: 1,
          saveCount: 1,
          shareCount: 0,
        }),
      )

      expect(saveHeavy).toBeGreaterThan(likeHeavy)
    })

    it('decays as the look gets older', () => {
      const newer = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          publishedAt: new Date('2026-04-19T00:00:00.000Z'),
          likeCount: 4,
          commentCount: 2,
          saveCount: 2,
          shareCount: 0,
        }),
      )

      const older = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          publishedAt: new Date('2026-03-20T00:00:00.000Z'),
          likeCount: 4,
          commentCount: 2,
          saveCount: 2,
          shareCount: 0,
        }),
      )

      expect(newer).toBeGreaterThan(older)
    })

    it('returns a stable rounded score', () => {
      const result = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )

      expect(result).toBe(37.5667)
    })
  })

  describe('computeLookPostRankScore', () => {
    it('returns 0 for non-score-eligible looks', () => {
      const result = computeLookPostRankScore(
        makeScoreEligibleLookRow({
          publishedAt: null,
          likeCount: 10,
          commentCount: 4,
          saveCount: 2,
          shareCount: 1,
        }),
      )

      expect(result).toBe(0)
    })

    it('computes rank score from recency, persisted engagement, and impressions', () => {
      // weighted = 11·1 + 6·2 + 3·5 + 2·3 = 44; raw engagement = 22 floors the
      // zero viewCount → smoothedRate = (44 + 0.08·50)/(22 + 50) = 48/72;
      // recency (1 day) = 7/8; ·scale 200 = 116.6667. Cold start (§2.1):
      // 45·(1 − 22/50)·(13/14) = 23.4 → 140.0667.
      const result = computeLookPostRankScore(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )

      expect(result).toBe(140.0667)
    })

    it('lowers rank as impressions accrue without matching engagement', () => {
      const thin = computeLookPostRankScore(
        makeScoreEligibleLookRow({ saveCount: 5, viewCount: 20 }),
      )
      const dilutedByViews = computeLookPostRankScore(
        makeScoreEligibleLookRow({ saveCount: 5, viewCount: 4000 }),
      )

      expect(dilutedByViews).toBeLessThan(thin)
    })

    it('weights saves above likes', () => {
      const saveHeavy = computeLookPostRankScore(
        makeScoreEligibleLookRow({
          likeCount: 1,
          commentCount: 1,
          saveCount: 4,
          shareCount: 0,
        }),
      )

      const likeHeavy = computeLookPostRankScore(
        makeScoreEligibleLookRow({
          likeCount: 4,
          commentCount: 1,
          saveCount: 1,
          shareCount: 0,
        }),
      )

      expect(saveHeavy).toBeGreaterThan(likeHeavy)
    })

    it('decays as the look gets older', () => {
      const newer = computeLookPostRankScore(
        makeScoreEligibleLookRow({
          publishedAt: new Date('2026-04-19T00:00:00.000Z'),
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )

      const older = computeLookPostRankScore(
        makeScoreEligibleLookRow({
          publishedAt: new Date('2026-03-20T00:00:00.000Z'),
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )

      expect(newer).toBeGreaterThan(older)
    })
  })

  describe('recomputeLookPostLikeCount', () => {
    it('recomputes likeCount and persists updated scores', async () => {
      const db = makeDb()
      db.lookLike.count.mockResolvedValue(7)
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 0,
          commentCount: 4,
          saveCount: 9,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostLikeCount(
        asTransactionClient(db),
        'look_1',
      )

      expect(db.lookLike.count).toHaveBeenCalledWith({
        where: { lookPostId: 'look_1' },
      })

      expect(db.lookPost.findUnique).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        select: {
          id: true,
          status: true,
          moderationStatus: true,
          publishedAt: true,
          likeCount: true,
          commentCount: true,
          saveCount: true,
          shareCount: true,
          viewCount: true,
          service: { select: { categoryId: true } },
        },
      })

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          likeCount: 7,
          spotlightScore: 69.02,
          rankScore: 193.5389,
        },
        select: { id: true },
      })

      expect(result).toBe(7)
    })
  })

  describe('recomputeLookPostCommentCount', () => {
    it('recomputes approved commentCount and persists updated scores', async () => {
      const db = makeDb()
      db.lookComment.count.mockResolvedValue(4)
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 7,
          commentCount: 0,
          saveCount: 9,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostCommentCount(
        asTransactionClient(db),
        'look_1',
      )

      expect(db.lookComment.count).toHaveBeenCalledWith({
        where: {
          lookPostId: 'look_1',
          moderationStatus: ModerationStatus.APPROVED,
        },
      })

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          commentCount: 4,
          spotlightScore: 69.02,
          rankScore: 193.5389,
        },
        select: { id: true },
      })

      expect(result).toBe(4)
    })
  })

  describe('recomputeLookCommentLikeCount', () => {
    it('counts the comment’s likes and persists likeCount on the comment row', async () => {
      const db = makeDb()
      db.lookCommentLike.count.mockResolvedValue(5)
      db.lookComment.update.mockResolvedValue({ id: 'comment_1' })

      const result = await recomputeLookCommentLikeCount(
        asTransactionClient(db),
        'comment_1',
      )

      expect(db.lookCommentLike.count).toHaveBeenCalledWith({
        where: { lookCommentId: 'comment_1' },
      })
      expect(db.lookComment.update).toHaveBeenCalledWith({
        where: { id: 'comment_1' },
        data: { likeCount: 5 },
        select: { id: true },
      })
      // Comment likes don't feed the look's spotlight/rank scores.
      expect(db.lookPost.update).not.toHaveBeenCalled()
      expect(result).toBe(5)
    })
  })

  describe('recomputeLookCommentReplyCount', () => {
    it('counts approved replies of the parent and persists replyCount', async () => {
      const db = makeDb()
      db.lookComment.count.mockResolvedValue(3)
      db.lookComment.update.mockResolvedValue({ id: 'parent_1' })

      const result = await recomputeLookCommentReplyCount(
        asTransactionClient(db),
        'parent_1',
      )

      expect(db.lookComment.count).toHaveBeenCalledWith({
        where: {
          parentCommentId: 'parent_1',
          moderationStatus: ModerationStatus.APPROVED,
        },
      })
      expect(db.lookComment.update).toHaveBeenCalledWith({
        where: { id: 'parent_1' },
        data: { replyCount: 3 },
        select: { id: true },
      })
      expect(result).toBe(3)
    })
  })

  describe('recomputeLookPostSaveCount', () => {
    it('recomputes saveCount and persists updated scores', async () => {
      const db = makeDb()
      db.boardItem.count.mockResolvedValue(9)
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 7,
          commentCount: 4,
          saveCount: 0,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostSaveCount(
        asTransactionClient(db),
        'look_1',
      )

      expect(db.boardItem.count).toHaveBeenCalledWith({
        where: { lookPostId: 'look_1' },
      })

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          saveCount: 9,
          spotlightScore: 69.02,
          rankScore: 193.5389,
        },
        select: { id: true },
      })

      expect(result).toBe(9)
    })
  })

  describe('recomputeLookPostSpotlightScore', () => {
    it('recomputes spotlightScore from the current persisted look row', async () => {
      const db = makeDb()
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostSpotlightScore(
        asTransactionClient(db),
        'look_1',
      )

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          spotlightScore: 37.5667,
        },
        select: { id: true },
      })

      expect(result).toBe(37.5667)
    })

    it('uses an explicit now option for deterministic spotlight recomputes', async () => {
      const db = makeDb()
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostSpotlightScore(
        asTransactionClient(db),
        'look_1',
        {
          now: new Date('2026-04-21T00:00:00.000Z'),
        },
      )

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          spotlightScore: 35.2188,
        },
        select: { id: true },
      })

      expect(result).toBe(35.2188)
    })
  })

  describe('recomputeLookPostRankScore', () => {
    it('recomputes rankScore from the current persisted look row', async () => {
      const db = makeDb()
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostRankScore(
        asTransactionClient(db),
        'look_1',
      )

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          rankScore: 140.0667,
        },
        select: { id: true },
      })

      expect(result).toBe(140.0667)
    })

    it('resolves the per-category prior for a categorized look', async () => {
      const db = makeDb()
      const row = {
        ...makeScoreEligibleLookRow({
          likeCount: 2,
          viewCount: 100,
        }),
        service: { categoryId: 'cat_hair' },
      }
      db.lookPost.findUnique.mockResolvedValue(row)
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })
      // A category whose typical rate is much higher than the global 0.08.
      db.lookCategoryRankStat.findUnique.mockResolvedValue({
        weightedEngagement: 400,
        impressions: 1_000,
      })

      const now = new Date('2026-04-20T00:00:00.000Z')
      const result = await recomputeLookPostRankScore(
        asTransactionClient(db),
        'look_1',
        { now },
      )

      expect(db.lookCategoryRankStat.findUnique).toHaveBeenCalledWith({
        where: { categoryId: 'cat_hair' },
        select: { weightedEngagement: true, impressions: true },
      })
      expect(result).toBe(
        computeLookPostRankScore(row, {
          now,
          prior: { rate: 0.4, strength: 50 },
        }),
      )
      // Sanity: the category prior actually moved the score off the
      // global-prior value.
      expect(result).not.toBe(computeLookPostRankScore(row, { now }))
    })

    it('skips the stat lookup when the caller pins an explicit prior', async () => {
      const db = makeDb()
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({ likeCount: 2, viewCount: 100 }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      await recomputeLookPostRankScore(asTransactionClient(db), 'look_1', {
        now: new Date('2026-04-20T00:00:00.000Z'),
        prior: { rate: 0.2, strength: 50 },
      })

      expect(db.lookCategoryRankStat.findUnique).not.toHaveBeenCalled()
    })

    it('uses the global prior for uncategorized looks without a stat lookup', async () => {
      const db = makeDb()
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({ likeCount: 2, viewCount: 100 }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      await recomputeLookPostRankScore(asTransactionClient(db), 'look_1', {
        now: new Date('2026-04-20T00:00:00.000Z'),
      })

      expect(db.lookCategoryRankStat.findUnique).not.toHaveBeenCalled()
    })

    it('uses an explicit now option for deterministic rank recomputes', async () => {
      const db = makeDb()
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostRankScore(
        asTransactionClient(db),
        'look_1',
        {
          now: new Date('2026-04-21T00:00:00.000Z'),
        },
      )

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          rankScore: 125.3037,
        },
        select: { id: true },
      })

      expect(result).toBe(125.3037)
    })
  })

  describe('recomputeLookPostScores', () => {
    it('recomputes spotlight and rank scores together and persists them in one update', async () => {
      const db = makeDb()
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostScores(
        asTransactionClient(db),
        'look_1',
      )

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          spotlightScore: 37.5667,
          rankScore: 140.0667,
        },
        select: { id: true },
      })

      expect(result).toEqual({
        spotlightScore: 37.5667,
        rankScore: 140.0667,
      })
    })
  })

  describe('recomputeLookPostCounters', () => {
    it('recomputes like/comment/save counts and scores together in one update', async () => {
      const db = makeDb()
      db.lookLike.count.mockResolvedValue(11)
      db.lookComment.count.mockResolvedValue(6)
      db.boardItem.count.mockResolvedValue(3)
      db.lookPost.findUnique.mockResolvedValue(
        makeScoreEligibleLookRow({
          likeCount: 0,
          commentCount: 0,
          saveCount: 0,
          shareCount: 2,
        }),
      )
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostCounters(
        asTransactionClient(db),
        'look_1',
      )

      expect(db.lookLike.count).toHaveBeenCalledWith({
        where: { lookPostId: 'look_1' },
      })

      expect(db.lookComment.count).toHaveBeenCalledWith({
        where: {
          lookPostId: 'look_1',
          moderationStatus: ModerationStatus.APPROVED,
        },
      })

      expect(db.boardItem.count).toHaveBeenCalledWith({
        where: { lookPostId: 'look_1' },
      })

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          spotlightScore: 37.5667,
          rankScore: 140.0667,
        },
        select: { id: true },
      })

      expect(result).toEqual({
        likeCount: 11,
        commentCount: 6,
        saveCount: 3,
        spotlightScore: 37.5667,
        rankScore: 140.0667,
      })
    })
  })
})