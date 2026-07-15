import { describe, expect, it } from 'vitest'

import {
  LOOK_CATEGORY_TREND,
  computeCategoryTrendStrengths,
  fetchCategoryTrendStrengths,
  foldCategoryTrendToRoots,
  resolveRootCategoryId,
  type CategoryTrendNode,
} from './categoryTrendStats'

describe('resolveRootCategoryId', () => {
  const parentById = new Map<string, string | null>([
    ['hair', null],
    ['hair-color', 'hair'],
    ['balayage-cat', 'hair-color'],
    ['nails', null],
  ])

  it('walks a leaf up to its top-level ancestor', () => {
    expect(resolveRootCategoryId('balayage-cat', parentById)).toBe('hair')
    expect(resolveRootCategoryId('hair-color', parentById)).toBe('hair')
  })

  it('returns a root category unchanged', () => {
    expect(resolveRootCategoryId('hair', parentById)).toBe('hair')
    expect(resolveRootCategoryId('nails', parentById)).toBe('nails')
  })

  it('stops at an unknown or dangling parent', () => {
    // Unknown category → itself.
    expect(resolveRootCategoryId('mystery', parentById)).toBe('mystery')
    // Dangling parent id (parent not in the map) → stop at the child.
    const dangling = new Map<string, string | null>([['leaf', 'ghost']])
    expect(resolveRootCategoryId('leaf', dangling)).toBe('leaf')
  })

  it('does not loop on a parent cycle', () => {
    const cyclic = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
    ])
    // Returns a concrete id rather than hanging.
    expect(['a', 'b']).toContain(resolveRootCategoryId('a', cyclic))
  })
})

describe('foldCategoryTrendToRoots', () => {
  const categories: CategoryTrendNode[] = [
    { id: 'hair', slug: 'hair', parentId: null },
    { id: 'hair-color', slug: 'hair-color', parentId: 'hair' },
    { id: 'haircut', slug: 'haircut', parentId: 'hair' },
    { id: 'nails', slug: 'nails', parentId: null },
  ]

  it('sums every descendant into one family row keyed by the root', () => {
    const rows = foldCategoryTrendToRoots(
      [
        { categoryId: 'hair-color', weightedEngagement: 10, impressions: 100, lookCount: 2 },
        { categoryId: 'haircut', weightedEngagement: 5, impressions: 50, lookCount: 1 },
        { categoryId: 'hair', weightedEngagement: 1, impressions: 10, lookCount: 1 },
      ],
      categories,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      categoryId: 'hair',
      categorySlug: 'hair',
      weightedEngagement: 16,
      impressions: 160,
      lookCount: 4,
    })
  })

  it('keeps distinct families separate and skips zero-impression roots', () => {
    const rows = foldCategoryTrendToRoots(
      [
        { categoryId: 'hair-color', weightedEngagement: 4, impressions: 40, lookCount: 1 },
        { categoryId: 'nails', weightedEngagement: 0, impressions: 0, lookCount: 0 },
      ],
      categories,
    )

    expect(rows.map((r) => r.categorySlug).sort()).toEqual(['hair'])
  })

  it('drops leaves whose root category is absent from the taxonomy', () => {
    const rows = foldCategoryTrendToRoots(
      [{ categoryId: 'orphan', weightedEngagement: 9, impressions: 90, lookCount: 3 }],
      categories,
    )
    expect(rows).toEqual([])
  })

  it('coerces negative / non-finite sums to safe values', () => {
    const rows = foldCategoryTrendToRoots(
      [
        {
          categoryId: 'hair',
          weightedEngagement: Number.NaN,
          impressions: -5,
          lookCount: -1,
        },
        { categoryId: 'haircut', weightedEngagement: 8, impressions: 80, lookCount: 2 },
      ],
      categories,
    )
    // NaN engagement + negative impressions coerce to 0; the sibling leaf carries it.
    expect(rows[0]).toMatchObject({
      categorySlug: 'hair',
      weightedEngagement: 8,
      impressions: 80,
      lookCount: 2,
    })
  })
})

describe('computeCategoryTrendStrengths', () => {
  const min = LOOK_CATEGORY_TREND.minImpressions

  it('scores the hottest evidenced family at ~1 and colder families proportionally lower', () => {
    const strengths = computeCategoryTrendStrengths([
      // rate 0.4 — hottest
      { categorySlug: 'hair', weightedEngagement: 0.4 * min * 2, impressions: min * 2 },
      // rate 0.2 — half as hot, fully evidenced
      { categorySlug: 'nails', weightedEngagement: 0.2 * min * 2, impressions: min * 2 },
    ])

    expect(strengths.get('hair')).toBeCloseTo(1, 5)
    expect(strengths.get('nails')).toBeCloseTo(0.5, 5)
  })

  it('damps a thin-evidence family by its confidence ramp', () => {
    const strengths = computeCategoryTrendStrengths([
      { categorySlug: 'hair', weightedEngagement: 0.4 * min * 2, impressions: min * 2 },
      // Same rate as hair but only 25% of the impression floor → confidence 0.25.
      {
        categorySlug: 'nails',
        weightedEngagement: 0.4 * (min / 4),
        impressions: min / 4,
      },
    ])

    expect(strengths.get('hair')).toBeCloseTo(1, 5)
    expect(strengths.get('nails')).toBeCloseTo(0.25, 5)
  })

  it('never lets a thin fluke family set the field reference', () => {
    const strengths = computeCategoryTrendStrengths([
      // Evidenced, moderate rate — the legitimate reference.
      { categorySlug: 'hair', weightedEngagement: 0.3 * min * 3, impressions: min * 3 },
      // Thin family with a freak 100% rate — must NOT flatten hair's strength.
      { categorySlug: 'brows', weightedEngagement: 5, impressions: 5 },
    ])

    // hair is the evidenced reference → full strength.
    expect(strengths.get('hair')).toBeCloseTo(1, 5)
    // brows' relative rate is huge but its confidence (5/min) crushes the lift.
    expect(strengths.get('brows')!).toBeLessThan(0.05)
  })

  it('returns 0 for every family when there is no engagement', () => {
    const strengths = computeCategoryTrendStrengths([
      { categorySlug: 'hair', weightedEngagement: 0, impressions: 0 },
      { categorySlug: 'nails', weightedEngagement: 0, impressions: min * 2 },
    ])
    expect(strengths.get('hair')).toBe(0)
    expect(strengths.get('nails')).toBe(0)
  })
})

describe('fetchCategoryTrendStrengths', () => {
  it('reads the trend table and reduces it to a slug → strength map', async () => {
    const min = LOOK_CATEGORY_TREND.minImpressions
    const db = {
      lookCategoryTrendStat: {
        findMany: async () => [
          { categorySlug: 'hair', weightedEngagement: 0.4 * min * 2, impressions: min * 2 },
          { categorySlug: 'nails', weightedEngagement: 0.2 * min * 2, impressions: min * 2 },
        ],
      },
    }

    const strengths = await fetchCategoryTrendStrengths(db)
    expect(strengths.get('hair')).toBeCloseTo(1, 5)
    expect(strengths.get('nails')).toBeCloseTo(0.5, 5)
  })

  it('returns an empty map when the table is empty', async () => {
    const db = { lookCategoryTrendStat: { findMany: async () => [] } }
    const strengths = await fetchCategoryTrendStrengths(db)
    expect(strengths.size).toBe(0)
  })
})
