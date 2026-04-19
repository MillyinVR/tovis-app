// lib/looks/counters.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModerationStatus, Prisma } from '@prisma/client'

import {
  recomputeLookPostCommentCount,
  recomputeLookPostCounters,
  recomputeLookPostLikeCount,
  recomputeLookPostSaveCount,
} from './counters'

function makeDb() {
  return {
    lookPost: {
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
 * the production helper accepts Prisma.TransactionClient | PrismaClient,
 * but the test only needs the few mocked members it actually calls.
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

  describe('recomputeLookPostLikeCount', () => {
    it('recomputes likeCount from LookLike rows and persists it on the look post', async () => {
      const db = makeDb()
      db.lookLike.count.mockResolvedValue(7)
      db.lookPost.update.mockResolvedValue({ id: 'look_1' })

      const result = await recomputeLookPostLikeCount(
        asTransactionClient(db),
        'look_1',
      )

      expect(db.lookLike.count).toHaveBeenCalledWith({
        where: { lookPostId: 'look_1' },
      })

      expect(db.lookPost.update).toHaveBeenCalledWith({
        where: { id: 'look_1' },
        data: { likeCount: 7 },
        select: { id: true },
      })

      expect(result).toBe(7)
    })
  })

  describe('recomputeLookPostCommentCount', () => {
    it('recomputes commentCount from approved LookComment rows and persists it on the look post', async () => {
      const db = makeDb()
      db.lookComment.count.mockResolvedValue(4)
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
        data: { commentCount: 4 },
        select: { id: true },
      })

      expect(result).toBe(4)
    })
  })

  describe('recomputeLookPostSaveCount', () => {
    it('recomputes saveCount from BoardItem rows and persists it on the look post', async () => {
      const db = makeDb()
      db.boardItem.count.mockResolvedValue(9)
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
        data: { saveCount: 9 },
        select: { id: true },
      })

      expect(result).toBe(9)
    })
  })

  describe('recomputeLookPostCounters', () => {
    it('recomputes like/comment/save counts together and persists them in one update', async () => {
      const db = makeDb()
      db.lookLike.count.mockResolvedValue(11)
      db.lookComment.count.mockResolvedValue(6)
      db.boardItem.count.mockResolvedValue(3)
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
        },
        select: { id: true },
      })

      expect(result).toEqual({
        likeCount: 11,
        commentCount: 6,
        saveCount: 3,
      })
    })
  })
})