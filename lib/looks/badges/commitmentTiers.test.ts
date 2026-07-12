// lib/looks/badges/commitmentTiers.test.ts
import { describe, expect, it } from 'vitest'

import {
  COMMITMENT_TIER_BY_CATEGORY_SLUG,
  DEFAULT_COMMITMENT_TIER,
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
