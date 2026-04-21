// lib/looks/ranking.test.ts
import { describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  ModerationStatus,
} from '@prisma/client'

import {
  LOOK_POST_RANK_RECENCY_HALF_LIFE_DAYS,
  LOOK_POST_RANK_WEIGHTS,
  computeLookPostRankBaseEngagement,
  computeLookPostRankRecencyMultiplier,
  computeLookPostRankScore,
  isLookPostRankEligible,
} from './ranking'

function makeInput(
  overrides?: Partial<{
    status: LookPostStatus
    moderationStatus: ModerationStatus
    publishedAt: Date | null
    likeCount: number
    commentCount: number
    saveCount: number
  }>,
) {
  return {
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
  }
}

describe('lib/looks/ranking.ts', () => {
  describe('LOOK_POST_RANK_WEIGHTS', () => {
    it('keeps saves weighted above comments and comments above likes', () => {
      expect(LOOK_POST_RANK_WEIGHTS.save).toBeGreaterThan(
        LOOK_POST_RANK_WEIGHTS.comment,
      )
      expect(LOOK_POST_RANK_WEIGHTS.comment).toBeGreaterThan(
        LOOK_POST_RANK_WEIGHTS.like,
      )
    })
  })

  describe('isLookPostRankEligible', () => {
    it('returns false for non-published looks', () => {
      expect(
        isLookPostRankEligible(
          makeInput({
            status: LookPostStatus.DRAFT,
          }),
        ),
      ).toBe(false)
    })

    it('returns false for non-approved looks', () => {
      expect(
        isLookPostRankEligible(
          makeInput({
            moderationStatus: ModerationStatus.PENDING_REVIEW,
          }),
        ),
      ).toBe(false)
    })

    it('returns false when publishedAt is null', () => {
      expect(
        isLookPostRankEligible(
          makeInput({
            publishedAt: null,
          }),
        ),
      ).toBe(false)
    })

    it('returns true for published approved looks with publishedAt', () => {
      expect(isLookPostRankEligible(makeInput())).toBe(true)
    })
  })

  describe('computeLookPostRankBaseEngagement', () => {
    it('weights likes, comments, and saves correctly', () => {
      const result = computeLookPostRankBaseEngagement({
        likeCount: 11,
        commentCount: 6,
        saveCount: 3,
      })

      expect(result).toBe(35)
    })

    it('weights saves above likes at the same rough sample size', () => {
      const saveHeavy = computeLookPostRankBaseEngagement({
        likeCount: 1,
        commentCount: 1,
        saveCount: 4,
      })

      const likeHeavy = computeLookPostRankBaseEngagement({
        likeCount: 4,
        commentCount: 1,
        saveCount: 1,
      })

      expect(saveHeavy).toBeGreaterThan(likeHeavy)
    })

    it('normalizes negative and non-finite counts to zero', () => {
      const result = computeLookPostRankBaseEngagement({
        likeCount: -4,
        commentCount: Number.NaN,
        saveCount: Number.POSITIVE_INFINITY,
      })

      expect(result).toBe(0)
    })
  })

  describe('computeLookPostRankRecencyMultiplier', () => {
    it('returns 1 for a just-published look', () => {
      expect(
        computeLookPostRankRecencyMultiplier(
          new Date('2026-04-20T00:00:00.000Z'),
          {
            now: new Date('2026-04-20T00:00:00.000Z'),
          },
        ),
      ).toBe(1)
    })

    it('decays based on the configured half-life window', () => {
      expect(
        computeLookPostRankRecencyMultiplier(
          new Date('2026-04-13T00:00:00.000Z'),
          {
            now: new Date('2026-04-20T00:00:00.000Z'),
          },
        ),
      ).toBeCloseTo(
        1 / (1 + 7 / LOOK_POST_RANK_RECENCY_HALF_LIFE_DAYS),
        10,
      )
    })

    it('does not penalize future timestamps below 1', () => {
      expect(
        computeLookPostRankRecencyMultiplier(
          new Date('2026-04-21T00:00:00.000Z'),
          {
            now: new Date('2026-04-20T00:00:00.000Z'),
          },
        ),
      ).toBe(1)
    })

    it('throws for an invalid now option', () => {
      expect(() =>
        computeLookPostRankRecencyMultiplier(
          new Date('2026-04-20T00:00:00.000Z'),
          {
            now: new Date('invalid'),
          },
        ),
      ).toThrow('rank now must be a valid Date.')
    })
  })

  describe('computeLookPostRankScore', () => {
    it('returns 0 for ineligible looks', () => {
      expect(
        computeLookPostRankScore(
          makeInput({
            publishedAt: null,
            likeCount: 11,
            commentCount: 6,
            saveCount: 3,
          }),
          {
            now: new Date('2026-04-20T00:00:00.000Z'),
          },
        ),
      ).toBe(0)
    })

    it('weights saves above likes', () => {
      const saveHeavy = computeLookPostRankScore(
        makeInput({
          likeCount: 1,
          commentCount: 1,
          saveCount: 4,
        }),
        {
          now: new Date('2026-04-20T00:00:00.000Z'),
        },
      )

      const likeHeavy = computeLookPostRankScore(
        makeInput({
          likeCount: 4,
          commentCount: 1,
          saveCount: 1,
        }),
        {
          now: new Date('2026-04-20T00:00:00.000Z'),
        },
      )

      expect(saveHeavy).toBeGreaterThan(likeHeavy)
    })

    it('rewards newer looks over older looks with the same engagement', () => {
      const newer = computeLookPostRankScore(
        makeInput({
          publishedAt: new Date('2026-04-19T00:00:00.000Z'),
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
        }),
        {
          now: new Date('2026-04-20T00:00:00.000Z'),
        },
      )

      const older = computeLookPostRankScore(
        makeInput({
          publishedAt: new Date('2026-03-20T00:00:00.000Z'),
          likeCount: 11,
          commentCount: 6,
          saveCount: 3,
        }),
        {
          now: new Date('2026-04-20T00:00:00.000Z'),
        },
      )

      expect(newer).toBeGreaterThan(older)
    })

    it('returns a stable rounded score', () => {
      expect(
        computeLookPostRankScore(
          makeInput({
            likeCount: 11,
            commentCount: 6,
            saveCount: 3,
          }),
          {
            now: new Date('2026-04-20T00:00:00.000Z'),
          },
        ),
      ).toBe(30.625)
    })
  })
})