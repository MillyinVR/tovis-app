// lib/looks/counters.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

import {
  computeLookPostRankScore,
  computeLookPostSpotlightScore,
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
    },
    boardItem: {
      count: vi.fn(),
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

    it('weights saves/comments/shares above likes', () => {
      const result = computeLookPostSpotlightScore(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )

      expect(result).toBe(60)
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

    it('computes rank score from persisted engagement counts', () => {
      const result = computeLookPostRankScore(
        makeScoreEligibleLookRow({
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
          shareCount: 2,
        }),
      )

      expect(result).toBe(47)
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
        },
      })

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: {
          likeCount: 7,
          spotlightScore: 80,
          rankScore: 63,
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
          spotlightScore: 80,
          rankScore: 63,
        },
        select: { id: true },
      })

      expect(result).toBe(4)
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
          spotlightScore: 80,
          rankScore: 63,
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
          spotlightScore: 60,
        },
        select: { id: true },
      })

      expect(result).toBe(60)
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
          rankScore: 47,
        },
        select: { id: true },
      })

      expect(result).toBe(47)
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
          spotlightScore: 60,
          rankScore: 47,
        },
        select: { id: true },
      })

      expect(result).toEqual({
        spotlightScore: 60,
        rankScore: 47,
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
          spotlightScore: 60,
          rankScore: 47,
        },
        select: { id: true },
      })

      expect(result).toEqual({
        likeCount: 11,
        commentCount: 6,
        saveCount: 3,
        spotlightScore: 60,
        rankScore: 47,
      })
    })
  })
})