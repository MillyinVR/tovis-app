// lib/looks/badges/commitmentTiers.test.ts
import { describe, expect, it } from 'vitest'

import {
  COMMITMENT_TIER_BY_CATEGORY_SLUG,
  DEFAULT_COMMITMENT_TIER,
  consultWorthyCommitmentSlugs,
  isConsultWorthyCommitmentSlug,
  resolveCommitmentTier,
} from '@/lib/looks/badges/commitmentTiers'

describe('resolveCommitmentTier', () => {
  it('maps body-modification-adjacent categories to HIGH', () => {
    expect(resolveCommitmentTier('permanent-makeup')).toBe('HIGH')
  })

  it('maps routine categories to LOW', () => {
    expect(resolveCommitmentTier('haircut')).toBe('LOW')
    expect(resolveCommitmentTier('nails')).toBe('LOW')
    expect(resolveCommitmentTier('waxing')).toBe('LOW')
  })

  it('maps multi-session / meaningful-spend categories to MEDIUM', () => {
    expect(resolveCommitmentTier('hair-color')).toBe('MEDIUM')
    expect(resolveCommitmentTier('lashes')).toBe('MEDIUM')
  })

  it('defaults unknown slugs and uncategorized looks to MEDIUM', () => {
    expect(DEFAULT_COMMITMENT_TIER).toBe('MEDIUM')
    expect(resolveCommitmentTier('some-brand-new-category')).toBe('MEDIUM')
    expect(resolveCommitmentTier(null)).toBe('MEDIUM')
    expect(resolveCommitmentTier(undefined)).toBe('MEDIUM')
    expect(resolveCommitmentTier('')).toBe('MEDIUM')
  })

  it('keeps the policy map to known tiers only', () => {
    for (const tier of Object.values(COMMITMENT_TIER_BY_CATEGORY_SLUG)) {
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(tier)
    }
  })
})

describe('isConsultWorthyCommitmentSlug (§6.8 hesitation gate)', () => {
  it('accepts KNOWN HIGH and MEDIUM categories', () => {
    expect(isConsultWorthyCommitmentSlug('permanent-makeup')).toBe(true) // HIGH
    expect(isConsultWorthyCommitmentSlug('hair-color')).toBe(true) // MEDIUM
    expect(isConsultWorthyCommitmentSlug('hair-extensions')).toBe(true)
    expect(isConsultWorthyCommitmentSlug('lashes')).toBe(true)
    expect(isConsultWorthyCommitmentSlug('facials')).toBe(true)
  })

  it('rejects routine LOW categories', () => {
    expect(isConsultWorthyCommitmentSlug('haircut')).toBe(false)
    expect(isConsultWorthyCommitmentSlug('nails')).toBe(false)
    expect(isConsultWorthyCommitmentSlug('makeup')).toBe(false)
    expect(isConsultWorthyCommitmentSlug('waxing')).toBe(false)
    expect(isConsultWorthyCommitmentSlug('brows')).toBe(false)
  })

  it('rejects unknown / uncategorized slugs (never nudge a category we cannot name)', () => {
    // Distinct from resolveCommitmentTier, which DEFAULTS these to MEDIUM.
    expect(isConsultWorthyCommitmentSlug('some-brand-new-category')).toBe(false)
    expect(isConsultWorthyCommitmentSlug(null)).toBe(false)
    expect(isConsultWorthyCommitmentSlug(undefined)).toBe(false)
    expect(isConsultWorthyCommitmentSlug('')).toBe(false)
  })
})

describe('consultWorthyCommitmentSlugs', () => {
  it('lists exactly the HIGH ∪ MEDIUM slugs from the policy map', () => {
    const slugs = consultWorthyCommitmentSlugs()
    // Every listed slug is consult-worthy…
    for (const slug of slugs) {
      expect(isConsultWorthyCommitmentSlug(slug)).toBe(true)
    }
    // …and every consult-worthy map entry is listed (no drift).
    const expected = Object.entries(COMMITMENT_TIER_BY_CATEGORY_SLUG)
      .filter(([, tier]) => tier !== 'LOW')
      .map(([slug]) => slug)
    expect([...slugs].sort()).toEqual([...expected].sort())
    // The anchor set is non-empty and excludes LOW.
    expect(slugs).toContain('permanent-makeup')
    expect(slugs).not.toContain('haircut')
  })
})
