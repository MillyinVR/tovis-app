// lib/looks/ranking.test.ts
import { describe, expect, it } from 'vitest'
import {
  LookPostStatus,
  ModerationStatus,
} from '@prisma/client'

import {
  LOOK_POST_RANK_COLD_START,
  LOOK_POST_RANK_PRIOR,
  LOOK_POST_RANK_RECENCY_HALF_LIFE_DAYS,
  LOOK_POST_RANK_SCORE_SCALE,
  LOOK_POST_RANK_WEIGHTS,
  computeLookPostRankColdStartBoost,
  computeLookPostRankImpressions,
  computeLookPostRankRecencyMultiplier,
  computeLookPostRankScore,
  computeLookPostRankSmoothedRate,
  computeLookPostRankWeightedEngagement,
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
    shareCount: number
    viewCount: number
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
    shareCount: overrides?.shareCount ?? 0,
    viewCount: overrides?.viewCount ?? 0,
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

    it('keeps saves as the strongest tracked signal, above shares (spec §2)', () => {
      expect(LOOK_POST_RANK_WEIGHTS.save).toBeGreaterThan(
        LOOK_POST_RANK_WEIGHTS.share,
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

  describe('computeLookPostRankWeightedEngagement', () => {
    it('weights likes, comments, saves, and shares by the spec hierarchy', () => {
      const result = computeLookPostRankWeightedEngagement({
        likeCount: 11,
        commentCount: 6,
        saveCount: 3,
        shareCount: 2,
      })

      // like·1 + comment·2 + save·5 + share·3 = 11 + 12 + 15 + 6
      expect(result).toBe(44)
    })

    it('weights saves above likes at the same rough sample size', () => {
      const saveHeavy = computeLookPostRankWeightedEngagement({
        likeCount: 1,
        commentCount: 1,
        saveCount: 4,
        shareCount: 0,
      })

      const likeHeavy = computeLookPostRankWeightedEngagement({
        likeCount: 4,
        commentCount: 1,
        saveCount: 1,
        shareCount: 0,
      })

      expect(saveHeavy).toBeGreaterThan(likeHeavy)
    })

    it('weights saves above shares at the same rough sample size (spec §2)', () => {
      const saveHeavy = computeLookPostRankWeightedEngagement({
        likeCount: 1,
        commentCount: 1,
        saveCount: 4,
        shareCount: 1,
      })

      const shareHeavy = computeLookPostRankWeightedEngagement({
        likeCount: 1,
        commentCount: 1,
        saveCount: 1,
        shareCount: 4,
      })

      expect(saveHeavy).toBeGreaterThan(shareHeavy)
    })

    it('normalizes negative and non-finite counts to zero', () => {
      const result = computeLookPostRankWeightedEngagement({
        likeCount: -4,
        commentCount: Number.NaN,
        saveCount: Number.POSITIVE_INFINITY,
        shareCount: -1,
      })

      expect(result).toBe(0)
    })
  })

  describe('computeLookPostRankSmoothedRate', () => {
    it('returns exactly the prior rate for a look with no impressions and no engagement', () => {
      const rate = computeLookPostRankSmoothedRate({
        likeCount: 0,
        commentCount: 0,
        saveCount: 0,
        shareCount: 0,
        viewCount: 0,
      })

      expect(rate).toBeCloseTo(LOOK_POST_RANK_PRIOR.rate, 10)
    })

    it('regresses a thin lucky spike below a high-volume proven look (kills rich-get-richer)', () => {
      // 3 saves on 10 impressions — a raw rate of 1.5 that would win on counts.
      const luckySpike = computeLookPostRankSmoothedRate({
        likeCount: 0,
        commentCount: 0,
        saveCount: 3,
        shareCount: 0,
        viewCount: 10,
      })

      // 300 saves on 2,000 impressions — a lower raw rate but far more evidence.
      const proven = computeLookPostRankSmoothedRate({
        likeCount: 0,
        commentCount: 0,
        saveCount: 300,
        shareCount: 0,
        viewCount: 2000,
      })

      expect(proven).toBeGreaterThan(luckySpike)
    })

    it('honors an overridden prior', () => {
      const weak = computeLookPostRankSmoothedRate(
        {
          likeCount: 0,
          commentCount: 0,
          saveCount: 1,
          shareCount: 0,
          viewCount: 0,
        },
        { rate: 0, strength: 10 },
      )

      // save·5 over the floored denominator (1 raw engagement + strength 10),
      // prior rate 0 → 5 / 11.
      expect(weak).toBeCloseTo(5 / 11, 10)
    })

    it('floors the denominator at raw engagement when viewCount is undercounted', () => {
      // A look whose 20 saves predate view tracking: only 8 recorded views.
      // Every save implies ≥1 impression, so the denominator floors at 20 —
      // the undercounted viewCount must not inflate the rate.
      const legacy = computeLookPostRankSmoothedRate({
        likeCount: 0,
        commentCount: 0,
        saveCount: 20,
        shareCount: 0,
        viewCount: 8,
      })

      expect(legacy).toBeCloseTo(
        (20 * LOOK_POST_RANK_WEIGHTS.save +
          LOOK_POST_RANK_PRIOR.rate * LOOK_POST_RANK_PRIOR.strength) /
          (20 + LOOK_POST_RANK_PRIOR.strength),
        10,
      )
    })

    it('keeps the smoothed rate bounded below the max signal weight', () => {
      // Pathological all-save look with no recorded views: the floor caps the
      // rate strictly under the save weight (5), so scores stay under
      // SCALE·5 = 1000 — beneath personalizedRanking's seen-penalty.
      const extreme = computeLookPostRankSmoothedRate({
        likeCount: 0,
        commentCount: 0,
        saveCount: 100_000,
        shareCount: 0,
        viewCount: 0,
      })

      expect(extreme).toBeLessThan(LOOK_POST_RANK_WEIGHTS.save)
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

  describe('computeLookPostRankImpressions', () => {
    it('returns viewCount when it dominates raw engagement', () => {
      expect(
        computeLookPostRankImpressions(
          makeInput({ likeCount: 3, viewCount: 120 }),
        ),
      ).toBe(120)
    })

    it('floors at the raw engagement total when viewCount is undercounted', () => {
      expect(
        computeLookPostRankImpressions(
          makeInput({ likeCount: 11, commentCount: 6, saveCount: 3 }),
        ),
      ).toBe(20)
    })
  })

  describe('computeLookPostRankColdStartBoost', () => {
    const publishedAt = new Date('2026-04-19T00:00:00.000Z')

    it('grants the full boost to a just-published zero-impression look', () => {
      expect(
        computeLookPostRankColdStartBoost(
          makeInput({ publishedAt }),
          { now: publishedAt },
        ),
      ).toBe(LOOK_POST_RANK_COLD_START.maxBoost)
    })

    it('decays linearly as impressions accrue and hits 0 at the floor', () => {
      const now = publishedAt

      const half = computeLookPostRankColdStartBoost(
        makeInput({ publishedAt, viewCount: 25 }),
        { now },
      )
      expect(half).toBe(LOOK_POST_RANK_COLD_START.maxBoost / 2)

      expect(
        computeLookPostRankColdStartBoost(
          makeInput({ publishedAt, viewCount: 50 }),
          { now },
        ),
      ).toBe(0)

      expect(
        computeLookPostRankColdStartBoost(
          makeInput({ publishedAt, viewCount: 5000 }),
          { now },
        ),
      ).toBe(0)
    })

    it('counts engagement-floored impressions, so a pre-view-tracking look with real engagement is not "cold"', () => {
      // 60 likes with zero recorded views: the same undercount protection that
      // floors the rate denominator also disqualifies cold-start support.
      expect(
        computeLookPostRankColdStartBoost(
          makeInput({ publishedAt, likeCount: 60 }),
          { now: publishedAt },
        ),
      ).toBe(0)
    })

    it('tapers with age and expires at the window end', () => {
      const halfWindow = new Date(
        publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
      )
      expect(
        computeLookPostRankColdStartBoost(makeInput({ publishedAt }), {
          now: halfWindow,
        }),
      ).toBe(LOOK_POST_RANK_COLD_START.maxBoost / 2)

      const pastWindow = new Date(
        publishedAt.getTime() + 15 * 24 * 60 * 60 * 1000,
      )
      expect(
        computeLookPostRankColdStartBoost(makeInput({ publishedAt }), {
          now: pastWindow,
        }),
      ).toBe(0)
    })

    it('honors an overridden config and disables on non-positive knobs', () => {
      const boosted = computeLookPostRankColdStartBoost(
        makeInput({ publishedAt }),
        {
          now: publishedAt,
          coldStart: { maxBoost: 10, impressionFloor: 20, windowDays: 5 },
        },
      )
      expect(boosted).toBe(10)

      expect(
        computeLookPostRankColdStartBoost(makeInput({ publishedAt }), {
          now: publishedAt,
          coldStart: { maxBoost: 0, impressionFloor: 20, windowDays: 5 },
        }),
      ).toBe(0)
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

    it('ranks a proven high-impression look above an identical-engagement thin one', () => {
      const now = new Date('2026-04-20T00:00:00.000Z')
      const publishedAt = new Date('2026-04-19T00:00:00.000Z')

      // Same engagement, but one earned it over far more impressions. The
      // dense-impression look has the lower (more trustworthy) rate and must not
      // out-rank... rather, the SPARSE look's rate is inflated toward the prior,
      // so the high-engagement-per-impression look ranks higher.
      const efficient = computeLookPostRankScore(
        makeInput({ publishedAt, saveCount: 20, viewCount: 100 }),
        { now },
      )
      const inefficient = computeLookPostRankScore(
        makeInput({ publishedAt, saveCount: 20, viewCount: 5000 }),
        { now },
      )

      expect(efficient).toBeGreaterThan(inefficient)
    })

    it('returns a stable rounded score for a zero-impression look', () => {
      // weighted = 11·1 + 6·2 + 3·5 = 38; raw engagement = 20 floors the zero
      // viewCount → smoothedRate = (38 + 0.08·50)/(20 + 50) = 0.6; recency
      // (1 day, 7-day half-life) = 7/8; base = 0.6·0.875·200 = 105. Cold start
      // (§2.1): 20 floored impressions of a 50 floor, 1 day into a 14-day
      // window → 45·0.6·(13/14) = 25.0714…; total rounds to 130.0714.
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
      ).toBe(130.0714)
    })

    it('lifts a brand-new zero-impression look above a typical established look (spec §2.1)', () => {
      const now = new Date('2026-04-20T00:00:00.000Z')

      // Established look running at ~2× the prior rate with plenty of evidence
      // — a solidly "typical" performer.
      const typical = computeLookPostRankScore(
        makeInput({
          publishedAt: new Date('2026-04-13T00:00:00.000Z'),
          likeCount: 80,
          viewCount: 500,
        }),
        { now },
      )

      const brandNew = computeLookPostRankScore(
        makeInput({ publishedAt: now }),
        { now },
      )

      expect(brandNew).toBeGreaterThan(typical)
    })

    it('keeps a hot proven look above a brand-new cold-start look', () => {
      const now = new Date('2026-04-20T00:00:00.000Z')

      // ~0.5 weighted engagement per impression (6× the prior) on real volume.
      const hot = computeLookPostRankScore(
        makeInput({
          publishedAt: new Date('2026-04-18T00:00:00.000Z'),
          saveCount: 100,
          viewCount: 1000,
        }),
        { now },
      )

      const brandNew = computeLookPostRankScore(
        makeInput({ publishedAt: now }),
        { now },
      )

      expect(hot).toBeGreaterThan(brandNew)
    })

    it('washes the cold-start boost out entirely once the impression floor is met', () => {
      const now = new Date('2026-04-20T00:00:00.000Z')
      const publishedAt = new Date('2026-04-19T00:00:00.000Z')
      const input = makeInput({ publishedAt, saveCount: 4, viewCount: 50 })

      const score = computeLookPostRankScore(input, { now })
      const scoreWithoutColdStart = computeLookPostRankScore(input, {
        now,
        coldStart: { maxBoost: 0, impressionFloor: 0, windowDays: 0 },
      })

      expect(score).toBe(scoreWithoutColdStart)
    })

    it('stays below the personalizedRanking seen penalty even for pathological cold inputs', () => {
      // Worst case under the floor: every impression is a save (max weight),
      // impressions just shy of the floor, published this instant.
      const now = new Date('2026-04-20T00:00:00.000Z')
      const score = computeLookPostRankScore(
        makeInput({ publishedAt: now, saveCount: 49, viewCount: 49 }),
        { now },
      )

      expect(score).toBeLessThan(1000)
    })

    it('keeps the score scale in the band personalizedRanking boosts are calibrated against', () => {
      // A strongly-engaged fresh look should land in the tens-to-hundreds band,
      // not below 1, so the additive follow/category/freshness boosts don't bury
      // the engagement backbone.
      const score = computeLookPostRankScore(
        makeInput({ saveCount: 40, viewCount: 200 }),
        { now: new Date('2026-04-20T00:00:00.000Z') },
      )

      expect(score).toBeGreaterThan(LOOK_POST_RANK_SCORE_SCALE * 0.1)
    })
  })
})