// lib/looks/spotlight.test.ts
import { describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  ModerationStatus,
} from '@prisma/client'

import {
  LOOK_POST_SPOTLIGHT_MIN_INTERACTIONS,
  LOOK_POST_SPOTLIGHT_MIN_SAVE_COUNT,
  LOOK_POST_SPOTLIGHT_RECENCY_HALF_LIFE_DAYS,
  buildLookPostSpotlightEligibilityWhere,
  computeLookPostSpotlightRecencyMultiplier,
  computeLookPostSpotlightSaveRate,
  computeLookPostSpotlightScore,
  getLookPostSpotlightInteractionCount,
  isLookPostSpotlightEligible,
} from './spotlight'

function makeInput(overrides?: Partial<{
  status: LookPostStatus
  moderationStatus: ModerationStatus
  publishedAt: Date | null
  likeCount: number
  commentCount: number
  saveCount: number
}>) {
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

describe('lib/looks/spotlight.ts', () => {
  describe('getLookPostSpotlightInteractionCount', () => {
    it('sums like, comment, and save counts', () => {
      expect(
        getLookPostSpotlightInteractionCount(
          makeInput({
            likeCount: 4,
            commentCount: 2,
            saveCount: 3,
          }),
        ),
      ).toBe(9)
    })

    it('normalizes negative and non-finite values to zero', () => {
      expect(
        getLookPostSpotlightInteractionCount({
          likeCount: -4,
          commentCount: Number.NaN,
          saveCount: Number.POSITIVE_INFINITY,
        }),
      ).toBe(0)
    })
  })

  describe('computeLookPostSpotlightSaveRate', () => {
    it('returns 0 when there are no interactions', () => {
      expect(
        computeLookPostSpotlightSaveRate(
          makeInput({
            likeCount: 0,
            commentCount: 0,
            saveCount: 0,
          }),
        ),
      ).toBe(0)
    })

    it('computes save rate from interaction count', () => {
      expect(
        computeLookPostSpotlightSaveRate(
          makeInput({
            likeCount: 3,
            commentCount: 1,
            saveCount: 2,
          }),
        ),
      ).toBeCloseTo(2 / 6, 10)
    })
  })

  describe('computeLookPostSpotlightRecencyMultiplier', () => {
    it('returns 1 for a just-published look', () => {
      const publishedAt = new Date('2026-04-20T00:00:00.000Z')

      expect(
        computeLookPostSpotlightRecencyMultiplier(publishedAt, {
          now: new Date('2026-04-20T00:00:00.000Z'),
        }),
      ).toBe(1)
    })

    it('decays based on the configured half-life window', () => {
      const publishedAt = new Date('2026-04-06T00:00:00.000Z')

      expect(
        computeLookPostSpotlightRecencyMultiplier(publishedAt, {
          now: new Date('2026-04-20T00:00:00.000Z'),
        }),
      ).toBeCloseTo(
        1 / (1 + 14 / LOOK_POST_SPOTLIGHT_RECENCY_HALF_LIFE_DAYS),
        10,
      )
    })

    it('does not penalize future timestamps below 1', () => {
      const publishedAt = new Date('2026-04-21T00:00:00.000Z')

      expect(
        computeLookPostSpotlightRecencyMultiplier(publishedAt, {
          now: new Date('2026-04-20T00:00:00.000Z'),
        }),
      ).toBe(1)
    })
  })

  describe('isLookPostSpotlightEligible', () => {
    it('returns false for non-published looks', () => {
      expect(
        isLookPostSpotlightEligible(
          makeInput({
            status: LookPostStatus.DRAFT,
            likeCount: 3,
            commentCount: 1,
            saveCount: 2,
          }),
        ),
      ).toBe(false)
    })

    it('returns false for non-approved looks', () => {
      expect(
        isLookPostSpotlightEligible(
          makeInput({
            moderationStatus: ModerationStatus.PENDING_REVIEW,
            likeCount: 3,
            commentCount: 1,
            saveCount: 2,
          }),
        ),
      ).toBe(false)
    })

    it('returns false when publishedAt is null', () => {
      expect(
        isLookPostSpotlightEligible(
          makeInput({
            publishedAt: null,
            likeCount: 3,
            commentCount: 1,
            saveCount: 2,
          }),
        ),
      ).toBe(false)
    })

    it('returns false below the minimum interaction threshold', () => {
      expect(
        isLookPostSpotlightEligible(
          makeInput({
            likeCount: 2,
            commentCount: 1,
            saveCount: 1,
          }),
        ),
      ).toBe(false)
    })

    it('returns false when save count is below the minimum', () => {
      expect(
        isLookPostSpotlightEligible(
          makeInput({
            likeCount: LOOK_POST_SPOTLIGHT_MIN_INTERACTIONS,
            commentCount: 0,
            saveCount: LOOK_POST_SPOTLIGHT_MIN_SAVE_COUNT - 1,
          }),
        ),
      ).toBe(false)
    })

    it('returns true when all spotlight requirements are met', () => {
      expect(
        isLookPostSpotlightEligible(
          makeInput({
            likeCount: 3,
            commentCount: 1,
            saveCount: 2,
          }),
        ),
      ).toBe(true)
    })
  })

  describe('computeLookPostSpotlightScore', () => {
    it('returns 0 for ineligible looks', () => {
      expect(
        computeLookPostSpotlightScore(
          makeInput({
            likeCount: 2,
            commentCount: 1,
            saveCount: 1,
          }),
          {
            now: new Date('2026-04-20T00:00:00.000Z'),
          },
        ),
      ).toBe(0)
    })

    it('returns 0 when the look has no saves', () => {
      expect(
        computeLookPostSpotlightScore(
          makeInput({
            likeCount: 4,
            commentCount: 1,
            saveCount: 0,
          }),
          {
            now: new Date('2026-04-20T00:00:00.000Z'),
          },
        ),
      ).toBe(0)
    })

    it('rewards a more save-heavy interaction mix at the same sample size', () => {
      const saveHeavy = computeLookPostSpotlightScore(
        makeInput({
          likeCount: 1,
          commentCount: 1,
          saveCount: 4,
        }),
        {
          now: new Date('2026-04-20T00:00:00.000Z'),
        },
      )

      const likeHeavy = computeLookPostSpotlightScore(
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

    it('decays as the look gets older', () => {
      const newer = computeLookPostSpotlightScore(
        makeInput({
          publishedAt: new Date('2026-04-19T00:00:00.000Z'),
          likeCount: 4,
          commentCount: 2,
          saveCount: 2,
        }),
        {
          now: new Date('2026-04-20T00:00:00.000Z'),
        },
      )

      const older = computeLookPostSpotlightScore(
        makeInput({
          publishedAt: new Date('2026-03-20T00:00:00.000Z'),
          likeCount: 4,
          commentCount: 2,
          saveCount: 2,
        }),
        {
          now: new Date('2026-04-20T00:00:00.000Z'),
        },
      )

      expect(newer).toBeGreaterThan(older)
    })

    it('returns a stable rounded score', () => {
      expect(
        computeLookPostSpotlightScore(
          makeInput({
            likeCount: 11,
            commentCount: 6,
            saveCount: 3,
          }),
          {
            now: new Date('2026-04-20T00:00:00.000Z'),
          },
        ),
      ).toBe(37.5667)
    })
  })

  describe('buildLookPostSpotlightEligibilityWhere', () => {
    it('builds spotlight eligibility as spotlightScore > 0', () => {
      expect(buildLookPostSpotlightEligibilityWhere()).toEqual({
        spotlightScore: {
          gt: 0,
        },
      })
    })
  })
})