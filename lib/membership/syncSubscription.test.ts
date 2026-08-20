// lib/membership/syncSubscription.test.ts
//
// 🔴 These exist because of a real bug, not for coverage. `resolvePlanKey`'s
// metadata allow-list was hand-written as `'pro' | 'studio' | 'free'` and
// **omitted `premium`**, so a Premium subscriber's own `metadata.planKey` was
// discarded and the price-id fallback quietly became the only thing standing
// between a paying pro and the free tier. Every test below fails if `premium`
// is dropped from the plan-key list again.

import { describe, expect, it } from 'vitest'

import { resolvePlanKey } from '@/lib/membership/syncSubscription'
import { isPlanKey, normalizePlanKey } from '@/lib/pro/entitlements'

const PLAN_KEYS = ['free', 'pro', 'premium', 'studio'] as const

function subscriptionWith(args: {
  planKey?: string
  priceId?: string
}): Parameters<typeof resolvePlanKey>[0] {
  return {
    id: 'sub_test',
    status: 'active',
    customer: 'cus_test',
    metadata: args.planKey === undefined ? {} : { planKey: args.planKey },
    items: args.priceId
      ? { data: [{ price: { id: args.priceId } }] }
      : { data: [] },
  }
}

describe('isPlanKey', () => {
  it('accepts every plan key the entitlement matrix knows', () => {
    for (const key of PLAN_KEYS) {
      expect(isPlanKey(key), `${key} must be a recognised plan key`).toBe(true)
    }
  })

  it('rejects an unknown value instead of collapsing it to free', () => {
    // This is the whole difference from normalizePlanKey: the caller has to be
    // able to say "not a plan key" and fall through to another source.
    expect(isPlanKey('platinum')).toBe(false)
    expect(isPlanKey('')).toBe(false)
    expect(isPlanKey(null)).toBe(false)
    expect(isPlanKey(undefined)).toBe(false)
    expect(isPlanKey(7)).toBe(false)
    expect(normalizePlanKey('platinum')).toBe('free')
  })

  it('is not fooled by inherited Object properties', () => {
    // hasOwnProperty, not `in` — `'toString' in {}` is true.
    expect(isPlanKey('toString')).toBe(false)
    expect(isPlanKey('constructor')).toBe(false)
  })
})

describe('resolvePlanKey', () => {
  it('honours metadata.planKey for EVERY plan, premium included', () => {
    for (const key of PLAN_KEYS) {
      expect(
        resolvePlanKey(subscriptionWith({ planKey: key })),
        `metadata.planKey=${key} must be honoured without needing a price id`,
      ).toBe(key)
    }
  })

  it('resolves premium from metadata even with NO price id present', () => {
    // The regression this file exists for: with `premium` missing from the
    // list, this returned null and the caller fell back to the row's existing
    // planKey — `free` by schema default for a first-time upgrade.
    expect(resolvePlanKey(subscriptionWith({ planKey: 'premium' }))).toBe(
      'premium',
    )
  })

  it('falls through to the price-id lookup when metadata is unusable', () => {
    expect(resolvePlanKey(subscriptionWith({ planKey: 'platinum' }))).toBeNull()
    expect(resolvePlanKey(subscriptionWith({}))).toBeNull()
  })

  it('returns null when neither metadata nor a configured price matches', () => {
    expect(
      resolvePlanKey(subscriptionWith({ priceId: 'price_not_configured' })),
    ).toBeNull()
  })
})
