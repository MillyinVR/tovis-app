import { describe, it, expect } from 'vitest'
import { SubscriptionStatus } from '@prisma/client'

import {
  CAMERA_IMAGES_PER_MONTH,
  entitledStatuses,
  resolveCameraImageMonthlyQuota,
  resolveEntitlements,
  planGrants,
  planKeysGranting,
  effectivePlanKey,
  normalizePlanKey,
} from '@/lib/pro/entitlements'

describe('normalizePlanKey', () => {
  it('passes through pro/premium/studio and defaults everything else to free', () => {
    expect(normalizePlanKey('pro')).toBe('pro')
    expect(normalizePlanKey('premium')).toBe('premium')
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

  it('active Pro/Premium waive the discovery fee; Premium equals Pro on booleans', () => {
    expect(
      planGrants({
        planKey: 'pro',
        status: SubscriptionStatus.ACTIVE,
        entitlement: 'discovery_fee_waiver',
      }),
    ).toBe(true)
    expect(
      resolveEntitlements({
        planKey: 'premium',
        status: SubscriptionStatus.ACTIVE,
      }),
    ).toEqual(
      resolveEntitlements({ planKey: 'pro', status: SubscriptionStatus.ACTIVE }),
    )
    expect(
      planGrants({
        planKey: 'premium',
        status: SubscriptionStatus.ACTIVE,
        entitlement: 'white_label',
      }),
    ).toBe(false)
  })
})

describe('camera image monthly quota', () => {
  it('grants 3/6/30/30 across the tiers while entitled', () => {
    expect(CAMERA_IMAGES_PER_MONTH).toEqual({
      free: 3,
      pro: 6,
      premium: 30,
      studio: 30,
    })
    expect(
      resolveCameraImageMonthlyQuota({
        planKey: 'premium',
        status: SubscriptionStatus.ACTIVE,
      }),
    ).toBe(30)
    expect(
      resolveCameraImageMonthlyQuota({
        planKey: 'pro',
        status: SubscriptionStatus.TRIALING,
      }),
    ).toBe(6)
  })

  it('lapsed or missing subscriptions collapse to the free allowance', () => {
    expect(
      resolveCameraImageMonthlyQuota({
        planKey: 'premium',
        status: SubscriptionStatus.PAST_DUE,
      }),
    ).toBe(CAMERA_IMAGES_PER_MONTH.free)
    expect(
      resolveCameraImageMonthlyQuota({ planKey: null, status: null }),
    ).toBe(CAMERA_IMAGES_PER_MONTH.free)
  })
})

describe('SQL call-site helpers', () => {
  it('planKeysGranting mirrors the matrix (priority_discovery = all paid plans)', () => {
    expect(planKeysGranting('priority_discovery')).toEqual([
      'pro',
      'premium',
      'studio',
    ])
    expect(planKeysGranting('white_label')).toEqual(['studio'])
  })

  it('entitledStatuses is exactly ACTIVE + TRIALING', () => {
    expect(new Set(entitledStatuses())).toEqual(
      new Set([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]),
    )
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
