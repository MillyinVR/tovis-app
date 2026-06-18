import { describe, it, expect } from 'vitest'
import { DepositType } from '@prisma/client'

import {
  computeDepositCents,
  computeDiscoveryDepositPlan,
  resolveDepositRefundPlan,
  STRIPE_MIN_CHARGE_CENTS,
  type DepositSettings,
} from '@/lib/booking/discoveryDepositPlan'

const FLAT_20: DepositSettings = {
  depositEnabled: true,
  depositType: DepositType.FLAT,
  depositFlatAmountCents: 2000,
  depositPercent: null,
}

const PERCENT_25: DepositSettings = {
  depositEnabled: true,
  depositType: DepositType.PERCENT,
  depositFlatAmountCents: null,
  depositPercent: 25,
}

const DISABLED: DepositSettings = {
  depositEnabled: false,
  depositType: DepositType.FLAT,
  depositFlatAmountCents: 2000,
  depositPercent: null,
}

describe('computeDepositCents', () => {
  it('returns 0 when deposits are disabled', () => {
    expect(computeDepositCents({ settings: DISABLED, servicePriceCents: 10000 })).toBe(0)
  })

  it('returns the flat amount for FLAT', () => {
    expect(computeDepositCents({ settings: FLAT_20, servicePriceCents: 10000 })).toBe(2000)
  })

  it('computes a percentage of the service price for PERCENT (rounded)', () => {
    expect(computeDepositCents({ settings: PERCENT_25, servicePriceCents: 10000 })).toBe(2500)
    expect(computeDepositCents({ settings: PERCENT_25, servicePriceCents: 9999 })).toBe(2500) // round
  })

  it('clamps percent to 100 and ignores non-positive percents', () => {
    expect(
      computeDepositCents({
        settings: { ...PERCENT_25, depositPercent: 150 },
        servicePriceCents: 10000,
      }),
    ).toBe(10000)
    expect(
      computeDepositCents({
        settings: { ...PERCENT_25, depositPercent: 0 },
        servicePriceCents: 10000,
      }),
    ).toBe(0)
  })
})

describe('computeDiscoveryDepositPlan', () => {
  it('is all-zero when not a fee-eligible new discovery client', () => {
    expect(
      computeDiscoveryDepositPlan({
        settings: FLAT_20,
        servicePriceCents: 10000,
        isNewDiscoveryClient: false,
        discoveryFeeCents: 500,
      }),
    ).toEqual({ depositCents: 0, discoveryFeeCents: 0, totalUpfrontCents: 0 })
  })

  it('combines deposit + fee for an eligible new discovery client', () => {
    expect(
      computeDiscoveryDepositPlan({
        settings: FLAT_20,
        servicePriceCents: 10000,
        isNewDiscoveryClient: true,
        discoveryFeeCents: 500,
      }),
    ).toEqual({ depositCents: 2000, discoveryFeeCents: 500, totalUpfrontCents: 2500 })
  })

  it('charges only the fee when the pro takes no deposit (fee clears the minimum)', () => {
    expect(
      computeDiscoveryDepositPlan({
        settings: DISABLED,
        servicePriceCents: 10000,
        isNewDiscoveryClient: true,
        discoveryFeeCents: 500,
      }),
    ).toEqual({ depositCents: 0, discoveryFeeCents: 500, totalUpfrontCents: 500 })
  })

  it('collects nothing when deposit + fee cannot clear the Stripe minimum', () => {
    expect(
      computeDiscoveryDepositPlan({
        settings: DISABLED,
        servicePriceCents: 10000,
        isNewDiscoveryClient: true,
        discoveryFeeCents: STRIPE_MIN_CHARGE_CENTS - 1,
      }),
    ).toEqual({ depositCents: 0, discoveryFeeCents: 0, totalUpfrontCents: 0 })
  })
})

describe('resolveDepositRefundPlan', () => {
  const AMOUNTS = { depositCents: 2000, feeCents: 500 }

  it('pro cancel refunds deposit AND fee (resets the relationship)', () => {
    expect(
      resolveDepositRefundPlan({
        ...AMOUNTS,
        actorKind: 'pro',
        clientWithinFullRefundWindow: false,
      }),
    ).toEqual({ refundDepositCents: 2000, refundFee: true, refundAmountCents: 2500 })
  })

  it('admin cancel behaves like pro (deposit + fee)', () => {
    expect(
      resolveDepositRefundPlan({
        ...AMOUNTS,
        actorKind: 'admin',
        clientWithinFullRefundWindow: false,
      }),
    ).toEqual({ refundDepositCents: 2000, refundFee: true, refundAmountCents: 2500 })
  })

  it('client cancel >=24h refunds the deposit but KEEPS the fee', () => {
    expect(
      resolveDepositRefundPlan({
        ...AMOUNTS,
        actorKind: 'client',
        clientWithinFullRefundWindow: true,
      }),
    ).toEqual({ refundDepositCents: 2000, refundFee: false, refundAmountCents: 2000 })
  })

  it('client cancel <24h refunds nothing (deposit forfeited, fee kept)', () => {
    expect(
      resolveDepositRefundPlan({
        ...AMOUNTS,
        actorKind: 'client',
        clientWithinFullRefundWindow: false,
      }),
    ).toEqual({ refundDepositCents: 0, refundFee: false, refundAmountCents: 0 })
  })
})
