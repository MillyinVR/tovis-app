import { describe, it, expect } from 'vitest'
import { SubscriptionStatus } from '@prisma/client'

import {
  resolveEntitlements,
  planGrants,
  effectivePlanKey,
  normalizePlanKey,
} from '@/lib/pro/entitlements'

describe('normalizePlanKey', () => {
  it('passes through pro/studio and defaults everything else to free', () => {
    expect(normalizePlanKey('pro')).toBe('pro')
    expect(normalizePlanKey('studio')).toBe('studio')
    expect(normalizePlanKey('free')).toBe('free')
    expect(normalizePlanKey(null)).toBe('free')
    expect(normalizePlanKey('bogus')).toBe('free')
  })
})

describe('resolveEntitlements', () => {
  it('free plan grants no paid entitlements', () => {
    expect(
      resolveEntitlements({ planKey: 'free', status: SubscriptionStatus.ACTIVE }),
    ).toEqual([])
  })

  it('active Pro grants the Pro entitlements (incl. custom_handle + tax_export)', () => {
    const ents = resolveEntitlements({
      planKey: 'pro',
      status: SubscriptionStatus.ACTIVE,
    })
    expect(ents).toContain('custom_handle')
    expect(ents).toContain('tax_export')
    expect(ents).toContain('advanced_analytics')
    expect(ents).not.toContain('white_label')
  })

  it('trialing Pro is fully entitled (1st-month-free trial)', () => {
    expect(
      planGrants({
        planKey: 'pro',
        status: SubscriptionStatus.TRIALING,
        entitlement: 'tax_export',
      }),
    ).toBe(true)
  })

  it('studio adds white_label on top of Pro', () => {
    expect(
      planGrants({
        planKey: 'studio',
        status: SubscriptionStatus.ACTIVE,
        entitlement: 'white_label',
      }),
    ).toBe(true)
  })

  it('lapsed states collapse to free (paid features off, but never an error)', () => {
    for (const status of [
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.INCOMPLETE,
    ]) {
      expect(resolveEntitlements({ planKey: 'pro', status })).toEqual([])
      expect(
        planGrants({ planKey: 'studio', status, entitlement: 'white_label' }),
      ).toBe(false)
    }
  })

  it('missing status (no subscription row) = free', () => {
    expect(resolveEntitlements({ planKey: 'pro', status: null })).toEqual([])
  })
})

describe('effectivePlanKey', () => {
  it('reflects the paid plan only while entitled, else free', () => {
    expect(
      effectivePlanKey({ planKey: 'pro', status: SubscriptionStatus.ACTIVE }),
    ).toBe('pro')
    expect(
      effectivePlanKey({ planKey: 'pro', status: SubscriptionStatus.CANCELED }),
    ).toBe('free')
    expect(effectivePlanKey({ planKey: 'pro', status: null })).toBe('free')
  })
})
