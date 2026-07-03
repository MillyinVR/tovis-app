import { describe, it, expect } from 'vitest'
import { SubscriptionStatus } from '@prisma/client'

import {
  CAMERA_IMAGES_PER_MONTH,
  activeCompPlanKey,
  entitledStatuses,
  resolveCameraImageMonthlyQuota,
  resolveEffectiveEntitlements,
  resolveEffectivePlanKey,
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

describe('admin comps (resolveEffective*)', () => {
  const NOW = new Date('2026-07-03T12:00:00Z')
  const FUTURE = new Date('2026-09-01T00:00:00Z')
  const PAST = new Date('2026-06-01T00:00:00Z')

  it('an active comp grants its plan even with no paid subscription', () => {
    const state = {
      planKey: 'free',
      status: null,
      compPlanKey: 'premium',
      compUntil: FUTURE,
    }
    expect(activeCompPlanKey(state, NOW)).toBe('premium')
    expect(resolveEffectivePlanKey(state, NOW)).toBe('premium')
    expect(resolveEffectiveEntitlements(state, NOW)).toContain(
      'discovery_fee_waiver',
    )
    expect(resolveCameraImageMonthlyQuota(state, NOW)).toBe(30)
  })

  it('a comp survives a lapsed paid subscription', () => {
    const state = {
      planKey: 'premium',
      status: SubscriptionStatus.PAST_DUE,
      compPlanKey: 'pro',
      compUntil: FUTURE,
    }
    expect(resolveEffectivePlanKey(state, NOW)).toBe('pro')
    expect(resolveEffectiveEntitlements(state, NOW)).toContain('tax_export')
  })

  it('the higher of paid vs comp wins', () => {
    expect(
      resolveEffectivePlanKey(
        {
          planKey: 'premium',
          status: SubscriptionStatus.ACTIVE,
          compPlanKey: 'pro',
          compUntil: FUTURE,
        },
        NOW,
      ),
    ).toBe('premium')
    expect(
      resolveCameraImageMonthlyQuota(
        {
          planKey: 'pro',
          status: SubscriptionStatus.ACTIVE,
          compPlanKey: 'premium',
          compUntil: FUTURE,
        },
        NOW,
      ),
    ).toBe(30)
  })

  it('an expired comp is ignored (boundary: compUntil == now is expired)', () => {
    const base = { planKey: 'free', status: null, compPlanKey: 'pro' }
    expect(activeCompPlanKey({ ...base, compUntil: PAST }, NOW)).toBeNull()
    expect(activeCompPlanKey({ ...base, compUntil: NOW }, NOW)).toBeNull()
    expect(
      resolveEffectivePlanKey({ ...base, compUntil: PAST }, NOW),
    ).toBe('free')
  })

  it('missing comp fields behave exactly like the paid-only resolvers', () => {
    const state = { planKey: 'pro', status: SubscriptionStatus.ACTIVE }
    expect(resolveEffectivePlanKey(state, NOW)).toBe(
      effectivePlanKey(state),
    )
    expect(resolveEffectiveEntitlements(state, NOW)).toEqual(
      resolveEntitlements(state),
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
