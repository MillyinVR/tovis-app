// lib/looks/personalizedRanking.test.ts
import { describe, expect, it } from 'vitest'

import {
  PERSONALIZED_RANK_WEIGHTS,
  computeAvailabilityBoost,
  computeCategorySuppressionPenalty,
  computePersonalizedFreshnessBoost,
  computePersonalizedScore,
  computeVisualSimilarityBoost,
  cosineSimilarity,
  rankPersonalizedRows,
  type PersonalizedRankableRow,
  type PersonalizedViewerAffinity,
  type ProAvailabilitySignal,
} from './personalizedRanking'

const NOW = new Date('2026-07-04T12:00:00.000Z')

function row(overrides: Partial<PersonalizedRankableRow> = {}): PersonalizedRankableRow {
  return {
    id: overrides.id ?? 'look_1',
    professionalId: overrides.professionalId ?? 'pro_1',
    publishedAt: overrides.publishedAt ?? new Date('2026-07-01T12:00:00.000Z'),
    rankScore: overrides.rankScore ?? 10,
    service: overrides.service ?? { category: { slug: 'balayage' } },
    tags: overrides.tags ?? null,
  }
}

function affinity(
  overrides: Partial<{
    followed: string[]
    categories: Array<[string, number]>
    suppressions: Array<[string, number]>
    occasions: Array<[string, number]>
    tasteVector: number[] | null
    tasteSignalCount: number
  }> = {},
): PersonalizedViewerAffinity {
  return {
    followedProfessionalIds: new Set(overrides.followed ?? []),
    categoryWeights: new Map(overrides.categories ?? []),
    categorySuppressionWeights: new Map(overrides.suppressions ?? []),
    occasionTagWeights: new Map(overrides.occasions ?? []),
    tasteVector: overrides.tasteVector ?? null,
    tasteSignalCount: overrides.tasteSignalCount ?? 0,
  }
}

const EMPTY_SEEN: ReadonlySet<string> = new Set()

describe('lib/looks/personalizedRanking', () => {
  describe('computePersonalizedScore', () => {
    it('passes rankScore through when the viewer has no signals', () => {
      const score = computePersonalizedScore(row({ rankScore: 10 }), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })

      // base 10 + freshness (3 days old, 1-day half-life) → 10 + 6/(1+3)
      expect(score).toBeCloseTo(10 + PERSONALIZED_RANK_WEIGHTS.freshnessMax / 4, 5)
    })

    it('lifts a followed pro above an identical non-followed look', () => {
      const context = {
        affinity: affinity({ followed: ['pro_followed'] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }

      const followed = computePersonalizedScore(
        row({ id: 'a', professionalId: 'pro_followed' }),
        context,
      )
      const other = computePersonalizedScore(
        row({ id: 'b', professionalId: 'pro_other' }),
        context,
      )

      expect(followed - other).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.follow, 5)
    })

    it('surfaces a zero-engagement followed look (additive, not multiplicative)', () => {
      const score = computePersonalizedScore(
        row({
          professionalId: 'pro_followed',
          rankScore: 0,
          publishedAt: NOW,
        }),
        {
          affinity: affinity({ followed: ['pro_followed'] }),
          seenLookIds: EMPTY_SEEN,
          now: NOW,
        },
      )

      // rankScore 0 would zero out a multiplicative boost; additive keeps it high.
      expect(score).toBeGreaterThanOrEqual(PERSONALIZED_RANK_WEIGHTS.follow)
    })

    it('boosts an affinity category and caps the weight', () => {
      const uncapped = computePersonalizedScore(row(), {
        affinity: affinity({ categories: [['balayage', 3]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      const base = computePersonalizedScore(row(), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(uncapped - base).toBeCloseTo(
        3 * PERSONALIZED_RANK_WEIGHTS.categoryUnit,
        5,
      )

      const wayOver = computePersonalizedScore(row(), {
        affinity: affinity({ categories: [['balayage', 999]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(wayOver - base).toBeCloseTo(
        PERSONALIZED_RANK_WEIGHTS.categoryWeightCap *
          PERSONALIZED_RANK_WEIGHTS.categoryUnit,
        5,
      )
    })

    it('sinks a seen look below everything unseen', () => {
      const seen = computePersonalizedScore(row({ id: 'seen', rankScore: 50 }), {
        affinity: affinity(),
        seenLookIds: new Set(['seen']),
        now: NOW,
      })
      const fresh = computePersonalizedScore(row({ id: 'fresh', rankScore: 0 }), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(seen).toBeLessThan(fresh)
    })

    it('tolerates a missing category without throwing', () => {
      const score = computePersonalizedScore(
        row({ service: { category: null } }),
        {
          affinity: affinity({ categories: [['balayage', 5]] }),
          seenLookIds: EMPTY_SEEN,
          now: NOW,
        },
      )
      expect(Number.isFinite(score)).toBe(true)
    })

    it('boosts a look whose tags match a declared occasion', () => {
      const context = {
        affinity: affinity({ occasions: [['bridal', 1]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }

      const bridal = computePersonalizedScore(
        row({ id: 'a', tags: [{ slug: 'bridal' }, { slug: 'balayage' }] }),
        context,
      )
      const plain = computePersonalizedScore(
        row({ id: 'a', tags: [{ slug: 'balayage' }] }),
        context,
      )

      expect(bridal - plain).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.occasionMax, 5)
    })

    it('scales the occasion boost by the tag weight and takes the strongest match, not the sum', () => {
      const context = {
        affinity: affinity({
          occasions: [
            ['bridal', 0.5],
            ['wedding', 0.4],
          ],
        }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }

      const both = computePersonalizedScore(
        row({ id: 'a', tags: [{ slug: 'bridal' }, { slug: 'wedding' }] }),
        context,
      )
      const none = computePersonalizedScore(row({ id: 'a', tags: [] }), context)

      // strongest (0.5), NOT 0.5 + 0.4
      expect(both - none).toBeCloseTo(
        PERSONALIZED_RANK_WEIGHTS.occasionMax * 0.5,
        5,
      )
    })

    it('tolerates missing tags and clamps out-of-range weights', () => {
      const context = {
        affinity: affinity({ occasions: [['bridal', 7]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }

      const untagged = computePersonalizedScore(row({ id: 'a' }), context)
      expect(Number.isFinite(untagged)).toBe(true)

      const clamped = computePersonalizedScore(
        row({ id: 'a', tags: [{ slug: 'bridal' }] }),
        context,
      )
      expect(clamped - untagged).toBeCloseTo(
        PERSONALIZED_RANK_WEIGHTS.occasionMax,
        5,
      )
    })
  })

  describe('cosineSimilarity', () => {
    it('is 1 for identical, 0 for orthogonal, -1 for opposite vectors', () => {
      expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10)
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10)
      expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 10)
    })

    it('is scale-invariant (true cosine, not a raw dot product)', () => {
      // A taste vector is L2-normalized at write; look embeddings are raw. The
      // similarity must not change when one side is un-normalized.
      const normalized = cosineSimilarity([0.6, 0.8], [1, 0])
      const scaled = cosineSimilarity([0.6, 0.8], [7, 0])
      expect(scaled).toBeCloseTo(normalized, 10)
      expect(scaled).toBeCloseTo(0.6, 10)
    })

    it('returns 0 for a length mismatch or a zero-norm input', () => {
      expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
      expect(cosineSimilarity([], [])).toBe(0)
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    })
  })

  describe('computeVisualSimilarityBoost', () => {
    const FULL = PERSONALIZED_RANK_WEIGHTS.visualConfidenceFullSignals

    it('peaks at visualMax for a cosine-1 match at full confidence', () => {
      expect(
        computeVisualSimilarityBoost({
          tasteVector: [1, 0, 0],
          tasteSignalCount: FULL,
          candidateEmbedding: [5, 0, 0], // un-normalized, same direction
        }),
      ).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.visualMax, 6)
    })

    it('scales linearly with clamped cosine', () => {
      expect(
        computeVisualSimilarityBoost({
          tasteVector: [1, 0],
          tasteSignalCount: FULL,
          candidateEmbedding: [0.6, 0.8], // cosine 0.6
        }),
      ).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.visualMax * 0.6, 6)
    })

    it('clamps a negative cosine to 0 (dissimilar looks are not penalized here)', () => {
      expect(
        computeVisualSimilarityBoost({
          tasteVector: [1, 0],
          tasteSignalCount: FULL,
          candidateEmbedding: [-1, 0],
        }),
      ).toBe(0)
    })

    it('ramps confidence with signal count so a thin vector barely steers', () => {
      const halfConfidence = computeVisualSimilarityBoost({
        tasteVector: [1, 0],
        tasteSignalCount: FULL / 2,
        candidateEmbedding: [1, 0],
      })
      expect(halfConfidence).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.visualMax * 0.5, 6)

      // A 1-signal vector is heavily discounted.
      const oneSignal = computeVisualSimilarityBoost({
        tasteVector: [1, 0],
        tasteSignalCount: 1,
        candidateEmbedding: [1, 0],
      })
      expect(oneSignal).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.visualMax / FULL, 6)
    })

    it('caps confidence at 1 beyond the full-signal threshold', () => {
      expect(
        computeVisualSimilarityBoost({
          tasteVector: [1, 0],
          tasteSignalCount: FULL * 10,
          candidateEmbedding: [1, 0],
        }),
      ).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.visualMax, 6)
    })

    it('returns 0 when any input is missing or degenerate', () => {
      const candidate = [1, 0]
      expect(
        computeVisualSimilarityBoost({
          tasteVector: null,
          tasteSignalCount: FULL,
          candidateEmbedding: candidate,
        }),
      ).toBe(0)
      expect(
        computeVisualSimilarityBoost({
          tasteVector: [1, 0],
          tasteSignalCount: FULL,
          candidateEmbedding: null,
        }),
      ).toBe(0)
      expect(
        computeVisualSimilarityBoost({
          tasteVector: [1, 0],
          tasteSignalCount: 0,
          candidateEmbedding: candidate,
        }),
      ).toBe(0)
      expect(
        computeVisualSimilarityBoost({
          tasteVector: [],
          tasteSignalCount: FULL,
          candidateEmbedding: candidate,
        }),
      ).toBe(0)
    })
  })

  describe('computePersonalizedScore visual boost', () => {
    it('lifts a visually-similar candidate above a dissimilar one', () => {
      const context = {
        affinity: affinity({
          tasteVector: [1, 0, 0],
          tasteSignalCount: PERSONALIZED_RANK_WEIGHTS.visualConfidenceFullSignals,
        }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
        candidateEmbeddings: new Map<string, readonly number[]>([
          ['match', [1, 0, 0]],
          ['miss', [0, 1, 0]],
        ]),
      }

      const match = computePersonalizedScore(row({ id: 'match' }), context)
      const miss = computePersonalizedScore(row({ id: 'miss' }), context)

      expect(match - miss).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.visualMax, 5)
    })

    it('adds no visual boost when the candidate has no embedding on the page', () => {
      const context = {
        affinity: affinity({
          tasteVector: [1, 0, 0],
          tasteSignalCount: PERSONALIZED_RANK_WEIGHTS.visualConfidenceFullSignals,
        }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
        candidateEmbeddings: new Map<string, readonly number[]>(),
      }
      const withoutEmbedding = computePersonalizedScore(row({ id: 'x' }), context)
      const noVisualContext = {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }
      const baseline = computePersonalizedScore(row({ id: 'x' }), noVisualContext)

      expect(withoutEmbedding).toBeCloseTo(baseline, 5)
    })

    it('is null-safe when the context omits candidateEmbeddings entirely', () => {
      const score = computePersonalizedScore(row({ id: 'x' }), {
        affinity: affinity({ tasteVector: [1, 0], tasteSignalCount: 20 }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(Number.isFinite(score)).toBe(true)
    })
  })

  describe('computePersonalizedFreshnessBoost', () => {
    it('peaks for a brand-new look and decays with age', () => {
      expect(computePersonalizedFreshnessBoost(NOW, NOW)).toBeCloseTo(
        PERSONALIZED_RANK_WEIGHTS.freshnessMax,
        5,
      )

      const oneHalfLife = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
      expect(computePersonalizedFreshnessBoost(oneHalfLife, NOW)).toBeCloseTo(
        PERSONALIZED_RANK_WEIGHTS.freshnessMax / 2,
        5,
      )
    })

    it('returns 0 for a missing publishedAt', () => {
      expect(computePersonalizedFreshnessBoost(null, NOW)).toBe(0)
    })
  })

  describe('computeCategorySuppressionPenalty (§2.2)', () => {
    const { hideCategoryThreshold, hideCategoryFull, hideCategoryMax } =
      PERSONALIZED_RANK_WEIGHTS

    it('is 0 below the repeated-hide threshold (one dismissal never suppresses)', () => {
      expect(computeCategorySuppressionPenalty(0)).toBe(0)
      expect(computeCategorySuppressionPenalty(1)).toBe(0)
      expect(computeCategorySuppressionPenalty(hideCategoryThreshold)).toBe(0)
    })

    it('ramps from threshold to the cap and clamps beyond', () => {
      const mid = (hideCategoryThreshold + hideCategoryFull) / 2
      expect(computeCategorySuppressionPenalty(mid)).toBeCloseTo(
        hideCategoryMax / 2,
        5,
      )
      expect(computeCategorySuppressionPenalty(hideCategoryFull)).toBeCloseTo(
        hideCategoryMax,
        5,
      )
      expect(computeCategorySuppressionPenalty(999)).toBeCloseTo(
        hideCategoryMax,
        5,
      )
    })

    it('never returns a negative penalty', () => {
      expect(computeCategorySuppressionPenalty(-5)).toBe(0)
      expect(computeCategorySuppressionPenalty(Number.NaN)).toBe(0)
    })
  })

  describe('computePersonalizedScore hide suppression (§2.2)', () => {
    it('down-ranks a look in a repeatedly-hidden category', () => {
      const context = {
        affinity: affinity({ suppressions: [['balayage', 6]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }
      const suppressed = computePersonalizedScore(row({ id: 'a' }), context)
      const baseline = computePersonalizedScore(row({ id: 'a' }), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })

      expect(baseline - suppressed).toBeCloseTo(
        PERSONALIZED_RANK_WEIGHTS.hideCategoryMax,
        5,
      )
    })

    it('leaves other categories untouched', () => {
      const context = {
        affinity: affinity({ suppressions: [['bridal', 6]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }
      // The row is 'balayage'; suppression on 'bridal' doesn't apply.
      const score = computePersonalizedScore(row({ id: 'a' }), context)
      const baseline = computePersonalizedScore(row({ id: 'a' }), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(score).toBeCloseTo(baseline, 5)
    })

    it('does not penalize a look with no service category', () => {
      const context = {
        affinity: affinity({ suppressions: [['balayage', 6]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }
      // A look whose service resolves to no category slug (the row() helper's
      // `??` coerces a null service back to its default, so target the category).
      const score = computePersonalizedScore(
        row({ id: 'a', service: { category: null } }),
        context,
      )
      const baseline = computePersonalizedScore(
        row({ id: 'a', service: { category: null } }),
        {
          affinity: affinity(),
          seenLookIds: EMPTY_SEEN,
          now: NOW,
        },
      )
      expect(score).toBeCloseTo(baseline, 5)
    })
  })

  describe('rankPersonalizedRows', () => {
    it('orders a followed look ahead of a comparable-quality stranger', () => {
      const rows: PersonalizedRankableRow[] = [
        row({ id: 'stranger', professionalId: 'pro_x', rankScore: 5 }),
        row({ id: 'followed', professionalId: 'pro_followed', rankScore: 2 }),
      ]

      const ranked = rankPersonalizedRows(rows, {
        affinity: affinity({ followed: ['pro_followed'] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })

      // follow boost (25) + base 2 comfortably clears a stranger at base 5.
      expect(ranked[0]?.id).toBe('followed')
      expect(ranked[1]?.id).toBe('stranger')
    })

    it('still lets a genuinely viral stranger outrank a weak followed look', () => {
      // Intended blend behavior, not a bug: the personalized feed is discovery, not a
      // followed-only timeline (that is the Following tab). A big-engagement
      // stranger look wins over a near-dead followed one despite the boost.
      const rows: PersonalizedRankableRow[] = [
        row({ id: 'viral_stranger', professionalId: 'pro_x', rankScore: 60 }),
        row({ id: 'followed_weak', professionalId: 'pro_followed', rankScore: 1 }),
      ]

      const ranked = rankPersonalizedRows(rows, {
        affinity: affinity({ followed: ['pro_followed'] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })

      expect(ranked[0]?.id).toBe('viral_stranger')
    })

    it('does not mutate the input array', () => {
      const rows = [row({ id: 'a', rankScore: 1 }), row({ id: 'b', rankScore: 2 })]
      const snapshot = rows.map((r) => r.id)
      rankPersonalizedRows(rows, {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(rows.map((r) => r.id)).toEqual(snapshot)
    })

    it('falls back to the DB RANKED order on tied personalized scores', () => {
      // No viewer signals → score is base+freshness; same publishedAt → tie-break
      // by rankScore desc then id desc.
      const rows: PersonalizedRankableRow[] = [
        row({ id: 'low', rankScore: 5 }),
        row({ id: 'high', rankScore: 9 }),
      ]
      const ranked = rankPersonalizedRows(rows, {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(ranked.map((r) => r.id)).toEqual(['high', 'low'])
    })
  })

  describe('computeAvailabilityBoost', () => {
    const signal = (
      overrides: Partial<ProAvailabilitySignal> = {},
    ): ProAvailabilitySignal => ({
      // `in` check so an explicit `nextOpeningDate: null` isn't collapsed to NOW.
      nextOpeningDate:
        'nextOpeningDate' in overrides ? overrides.nextOpeningDate ?? null : NOW,
      fullness14d: overrides.fullness14d ?? 0,
    })

    it('is 0 for a missing signal or a null next-opening date', () => {
      expect(computeAvailabilityBoost({ signal: null, now: NOW })).toBe(0)
      expect(computeAvailabilityBoost({ signal: undefined, now: NOW })).toBe(0)
      expect(
        computeAvailabilityBoost({
          signal: signal({ nextOpeningDate: null }),
          now: NOW,
        }),
      ).toBe(0)
    })

    it('peaks for an opening today on a wide-open calendar', () => {
      // soonScore 1 + openness 1 → full availabilityMax.
      expect(
        computeAvailabilityBoost({
          signal: signal({ nextOpeningDate: NOW, fullness14d: 0 }),
          now: NOW,
        }),
      ).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.availabilityMax, 5)
    })

    it('a fully-booked-but-opening-today pro earns only the soon half', () => {
      // soonScore 1, openness 0 → half the max.
      expect(
        computeAvailabilityBoost({
          signal: signal({ nextOpeningDate: NOW, fullness14d: 1 }),
          now: NOW,
        }),
      ).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.availabilityMax * 0.5, 5)
    })

    it('decays as the next opening moves further out', () => {
      const halfLifeMs =
        PERSONALIZED_RANK_WEIGHTS.availabilitySoonHalfLifeDays *
        24 *
        60 *
        60 *
        1000
      const soon = computeAvailabilityBoost({
        signal: signal({ nextOpeningDate: new Date(NOW.getTime() + halfLifeMs) }),
        now: NOW,
      })
      const far = computeAvailabilityBoost({
        signal: signal({
          nextOpeningDate: new Date(NOW.getTime() + 6 * halfLifeMs),
        }),
        now: NOW,
      })
      // soonScore at one half-life is 0.5 → (0.5*0.5 + 0.5*1) = 0.75 of max.
      expect(soon).toBeCloseTo(PERSONALIZED_RANK_WEIGHTS.availabilityMax * 0.75, 5)
      expect(far).toBeLessThan(soon)
    })

    it('adds into the personalized score, keyed by professionalId', () => {
      const availabilitySignals = new Map<string, ProAvailabilitySignal>([
        ['pro_open', signal({ nextOpeningDate: NOW, fullness14d: 0 })],
      ])
      const base = computePersonalizedScore(row({ professionalId: 'pro_none' }), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
        availabilitySignals,
      })
      const boosted = computePersonalizedScore(
        row({ professionalId: 'pro_open' }),
        {
          affinity: affinity(),
          seenLookIds: EMPTY_SEEN,
          now: NOW,
          availabilitySignals,
        },
      )
      expect(boosted - base).toBeCloseTo(
        PERSONALIZED_RANK_WEIGHTS.availabilityMax,
        5,
      )
    })
  })
})
