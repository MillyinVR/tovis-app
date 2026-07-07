// lib/looks/categoryRankStats.test.ts
//
// Unit coverage for the pure rate math and the prior-resolution threshold
// logic. refreshLookCategoryRankStats (the raw-SQL aggregate) is covered
// against real Postgres in tests/integration/personalization-schema-pass.test.ts
// — a mocked $queryRaw would only test the mock.
import { describe, expect, it, vi } from 'vitest'

import {
  computeLookCategoryPriorRate,
  LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS,
  resolveLookPostRankPrior,
} from './categoryRankStats'
import { LOOK_POST_RANK_PRIOR } from '@/lib/looks/ranking'

function makeStatDb() {
  return {
    lookCategoryRankStat: {
      findUnique: vi.fn(),
    },
  }
}

describe('lib/looks/categoryRankStats', () => {
  describe('computeLookCategoryPriorRate', () => {
    it('returns null for missing, thin, or malformed stats', () => {
      expect(computeLookCategoryPriorRate(null)).toBeNull()
      expect(
        computeLookCategoryPriorRate({
          weightedEngagement: 100,
          impressions: LOOK_CATEGORY_PRIOR_MIN_IMPRESSIONS - 1,
        }),
      ).toBeNull()
      expect(
        computeLookCategoryPriorRate({
          weightedEngagement: -5,
          impressions: 10_000,
        }),
      ).toBeNull()
      expect(
        computeLookCategoryPriorRate({
          weightedEngagement: Number.NaN,
          impressions: 10_000,
        }),
      ).toBeNull()
    })

    it('returns the observed average rate once the category has evidence', () => {
      expect(
        computeLookCategoryPriorRate({
          weightedEngagement: 120,
          impressions: 1_000,
        }),
      ).toBeCloseTo(0.12)
    })

    it('clamps a corrupt rate below the max signal weight', () => {
      expect(
        computeLookCategoryPriorRate({
          weightedEngagement: 50_000,
          impressions: 1_000,
        }),
      ).toBe(5)
    })
  })

  describe('resolveLookPostRankPrior', () => {
    it('returns the global prior without a lookup for uncategorized looks', async () => {
      const db = makeStatDb()

      const prior = await resolveLookPostRankPrior(db, null)

      expect(prior).toBe(LOOK_POST_RANK_PRIOR)
      expect(db.lookCategoryRankStat.findUnique).not.toHaveBeenCalled()
    })

    it('falls back to the global prior when the stat row is missing or thin', async () => {
      const db = makeStatDb()
      db.lookCategoryRankStat.findUnique.mockResolvedValue(null)

      expect(await resolveLookPostRankPrior(db, 'cat_1')).toBe(
        LOOK_POST_RANK_PRIOR,
      )

      db.lookCategoryRankStat.findUnique.mockResolvedValue({
        weightedEngagement: 3,
        impressions: 40,
      })
      expect(await resolveLookPostRankPrior(db, 'cat_1')).toBe(
        LOOK_POST_RANK_PRIOR,
      )
    })

    it('uses the category rate with the GLOBAL strength once evidence exists', async () => {
      const db = makeStatDb()
      db.lookCategoryRankStat.findUnique.mockResolvedValue({
        weightedEngagement: 300,
        impressions: 2_000,
      })

      const prior = await resolveLookPostRankPrior(db, 'cat_1')

      expect(prior.rate).toBeCloseTo(0.15)
      expect(prior.strength).toBe(LOOK_POST_RANK_PRIOR.strength)
      expect(db.lookCategoryRankStat.findUnique).toHaveBeenCalledWith({
        where: { categoryId: 'cat_1' },
        select: { weightedEngagement: true, impressions: true },
      })
    })
  })
})
