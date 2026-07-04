// lib/looks/forYouRanking.test.ts
import { describe, expect, it } from 'vitest'

import {
  FOR_YOU_RANK_WEIGHTS,
  computeForYouFreshnessBoost,
  computeForYouScore,
  rankForYouRows,
  type ForYouRankableRow,
  type ForYouViewerAffinity,
} from './forYouRanking'

const NOW = new Date('2026-07-04T12:00:00.000Z')

function row(overrides: Partial<ForYouRankableRow> = {}): ForYouRankableRow {
  return {
    id: overrides.id ?? 'look_1',
    professionalId: overrides.professionalId ?? 'pro_1',
    publishedAt: overrides.publishedAt ?? new Date('2026-07-01T12:00:00.000Z'),
    rankScore: overrides.rankScore ?? 10,
    service: overrides.service ?? { category: { slug: 'balayage' } },
  }
}

function affinity(
  overrides: Partial<{
    followed: string[]
    categories: Array<[string, number]>
  }> = {},
): ForYouViewerAffinity {
  return {
    followedProfessionalIds: new Set(overrides.followed ?? []),
    categoryWeights: new Map(overrides.categories ?? []),
  }
}

const EMPTY_SEEN: ReadonlySet<string> = new Set()

describe('lib/looks/forYouRanking', () => {
  describe('computeForYouScore', () => {
    it('passes rankScore through when the viewer has no signals', () => {
      const score = computeForYouScore(row({ rankScore: 10 }), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })

      // base 10 + freshness (3 days old, 1-day half-life) → 10 + 6/(1+3)
      expect(score).toBeCloseTo(10 + FOR_YOU_RANK_WEIGHTS.freshnessMax / 4, 5)
    })

    it('lifts a followed pro above an identical non-followed look', () => {
      const context = {
        affinity: affinity({ followed: ['pro_followed'] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      }

      const followed = computeForYouScore(
        row({ id: 'a', professionalId: 'pro_followed' }),
        context,
      )
      const other = computeForYouScore(
        row({ id: 'b', professionalId: 'pro_other' }),
        context,
      )

      expect(followed - other).toBeCloseTo(FOR_YOU_RANK_WEIGHTS.follow, 5)
    })

    it('surfaces a zero-engagement followed look (additive, not multiplicative)', () => {
      const score = computeForYouScore(
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
      expect(score).toBeGreaterThanOrEqual(FOR_YOU_RANK_WEIGHTS.follow)
    })

    it('boosts an affinity category and caps the weight', () => {
      const uncapped = computeForYouScore(row(), {
        affinity: affinity({ categories: [['balayage', 3]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      const base = computeForYouScore(row(), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(uncapped - base).toBeCloseTo(
        3 * FOR_YOU_RANK_WEIGHTS.categoryUnit,
        5,
      )

      const wayOver = computeForYouScore(row(), {
        affinity: affinity({ categories: [['balayage', 999]] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(wayOver - base).toBeCloseTo(
        FOR_YOU_RANK_WEIGHTS.categoryWeightCap *
          FOR_YOU_RANK_WEIGHTS.categoryUnit,
        5,
      )
    })

    it('sinks a seen look below everything unseen', () => {
      const seen = computeForYouScore(row({ id: 'seen', rankScore: 50 }), {
        affinity: affinity(),
        seenLookIds: new Set(['seen']),
        now: NOW,
      })
      const fresh = computeForYouScore(row({ id: 'fresh', rankScore: 0 }), {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(seen).toBeLessThan(fresh)
    })

    it('tolerates a missing category without throwing', () => {
      const score = computeForYouScore(
        row({ service: { category: null } }),
        {
          affinity: affinity({ categories: [['balayage', 5]] }),
          seenLookIds: EMPTY_SEEN,
          now: NOW,
        },
      )
      expect(Number.isFinite(score)).toBe(true)
    })
  })

  describe('computeForYouFreshnessBoost', () => {
    it('peaks for a brand-new look and decays with age', () => {
      expect(computeForYouFreshnessBoost(NOW, NOW)).toBeCloseTo(
        FOR_YOU_RANK_WEIGHTS.freshnessMax,
        5,
      )

      const oneHalfLife = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
      expect(computeForYouFreshnessBoost(oneHalfLife, NOW)).toBeCloseTo(
        FOR_YOU_RANK_WEIGHTS.freshnessMax / 2,
        5,
      )
    })

    it('returns 0 for a missing publishedAt', () => {
      expect(computeForYouFreshnessBoost(null, NOW)).toBe(0)
    })
  })

  describe('rankForYouRows', () => {
    it('orders a followed look ahead of a comparable-quality stranger', () => {
      const rows: ForYouRankableRow[] = [
        row({ id: 'stranger', professionalId: 'pro_x', rankScore: 5 }),
        row({ id: 'followed', professionalId: 'pro_followed', rankScore: 2 }),
      ]

      const ranked = rankForYouRows(rows, {
        affinity: affinity({ followed: ['pro_followed'] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })

      // follow boost (25) + base 2 comfortably clears a stranger at base 5.
      expect(ranked[0]?.id).toBe('followed')
      expect(ranked[1]?.id).toBe('stranger')
    })

    it('still lets a genuinely viral stranger outrank a weak followed look', () => {
      // Intended blend behavior, not a bug: For You is discovery, not a
      // followed-only timeline (that is the Following tab). A big-engagement
      // stranger look wins over a near-dead followed one despite the boost.
      const rows: ForYouRankableRow[] = [
        row({ id: 'viral_stranger', professionalId: 'pro_x', rankScore: 60 }),
        row({ id: 'followed_weak', professionalId: 'pro_followed', rankScore: 1 }),
      ]

      const ranked = rankForYouRows(rows, {
        affinity: affinity({ followed: ['pro_followed'] }),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })

      expect(ranked[0]?.id).toBe('viral_stranger')
    })

    it('does not mutate the input array', () => {
      const rows = [row({ id: 'a', rankScore: 1 }), row({ id: 'b', rankScore: 2 })]
      const snapshot = rows.map((r) => r.id)
      rankForYouRows(rows, {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(rows.map((r) => r.id)).toEqual(snapshot)
    })

    it('falls back to the DB RANKED order on tied personalized scores', () => {
      // No viewer signals → score is base+freshness; same publishedAt → tie-break
      // by rankScore desc then id desc.
      const rows: ForYouRankableRow[] = [
        row({ id: 'low', rankScore: 5 }),
        row({ id: 'high', rankScore: 9 }),
      ]
      const ranked = rankForYouRows(rows, {
        affinity: affinity(),
        seenLookIds: EMPTY_SEEN,
        now: NOW,
      })
      expect(ranked.map((r) => r.id)).toEqual(['high', 'low'])
    })
  })
})
