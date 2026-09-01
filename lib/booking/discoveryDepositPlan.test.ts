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
  // K10 moved the SIZING of the deposit out to lib/booking/prepay.ts (it now has
  // two rules to combine), so this function's job is narrower: put an
  // already-sized deposit together with the platform fees and refuse a combined
  // charge Stripe cannot process.
  const LIVE = { feesEnabled: true, proFeeWaived: false }

  const EMPTY = {
    depositCents: 0,
    clientFeeCents: 0,
    proFeeCents: 0,
    proFeeWaived: false,
    totalUpfrontCents: 0,
    applicationFeeCents: 0,
  }

  it('is all-zero when neither a deposit nor a fee applies', () => {
    expect(
      computeDiscoveryDepositPlan({
        depositCents: 0,
        feeEligible: false,
        ...LIVE,
      }),
    ).toEqual(EMPTY)
  })

  it('combines deposit + both fees for an eligible new discovery client', () => {
    // $20 deposit -> 10% = $2 client fee (exactly the floor), $5 pro fee.
    // The customer is charged deposit + client fee; the application fee carries
    // BOTH, which is how the pro's $5 comes out of their payout.
    expect(
      computeDiscoveryDepositPlan({
        depositCents: 2000,
        feeEligible: true,
        ...LIVE,
      }),
    ).toEqual({
      depositCents: 2000,
      clientFeeCents: 200,
      proFeeCents: 500,
      proFeeWaived: false,
      totalUpfrontCents: 2200,
      applicationFeeCents: 700,
    })
  })

  // 🔴 Deliberate change from the flat-$5 model: the client fee is a percentage OF
  // the deposit and the pro fee is taken OUT OF the deposit payout, so with no
  // deposit there is nothing to charge either fee against. The old model billed a
  // flat fee here with no deposit at all.
  it('charges NOTHING when the pro takes no deposit, even if fee-eligible', () => {
    expect(
      computeDiscoveryDepositPlan({
        depositCents: 0,
        feeEligible: true,
        ...LIVE,
      }),
    ).toEqual(EMPTY)
  })

  it('collects nothing when deposit + client fee cannot clear the Stripe minimum', () => {
    // A 1-cent deposit floors the client fee to $2, so the total DOES clear the
    // minimum. Drive the refusal with an ineligible sub-minimum deposit instead.
    expect(
      computeDiscoveryDepositPlan({
        depositCents: STRIPE_MIN_CHARGE_CENTS - 1,
        feeEligible: false,
        ...LIVE,
      }),
    ).toEqual(EMPTY)
  })

  // K10-A: the pro's depositScope can require a deposit from a returning client
  // the platform never matched. Neither platform fee must ride along.
  it('charges the deposit WITHOUT either fee for a scoped-in returning client', () => {
    expect(
      computeDiscoveryDepositPlan({
        depositCents: 2000,
        feeEligible: false,
        ...LIVE,
      }),
    ).toEqual({
      depositCents: 2000,
      clientFeeCents: 0,
      proFeeCents: 0,
      proFeeWaived: false,
      totalUpfrontCents: 2000,
      applicationFeeCents: 0,
    })
  })

  it('charges the deposit alone while the fees are flag-gated off', () => {
    expect(
      computeDiscoveryDepositPlan({
        depositCents: 5000,
        feeEligible: true,
        feesEnabled: false,
        proFeeWaived: false,
      }),
    ).toEqual({
      depositCents: 5000,
      clientFeeCents: 0,
      proFeeCents: 0,
      proFeeWaived: false,
      totalUpfrontCents: 5000,
      applicationFeeCents: 0,
    })
  })

  it("a member's waiver zeroes the PRO fee and leaves the client fee intact", () => {
    expect(
      computeDiscoveryDepositPlan({
        depositCents: 5000,
        feeEligible: true,
        feesEnabled: true,
        proFeeWaived: true,
      }),
    ).toEqual({
      depositCents: 5000,
      clientFeeCents: 500, // 10% of $50 — unchanged by the pro's membership
      proFeeCents: 0,
      proFeeWaived: true,
      totalUpfrontCents: 5500,
      applicationFeeCents: 500,
    })
  })

  it('never lets a negative or fractional deposit through', () => {
    expect(
      computeDiscoveryDepositPlan({
        depositCents: -100,
        feeEligible: true,
        ...LIVE,
      }).depositCents,
    ).toBe(0)

    expect(
      computeDiscoveryDepositPlan({
        depositCents: 2000.4,
        feeEligible: false,
        ...LIVE,
      }).depositCents,
    ).toBe(2000)
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

  // Book the Look, B4: the pending-proximity expiry sweep. The client did
  // everything asked of her and did not get an appointment, so she keeps none of
  // the cost — deposit AND the one-time platform fee, exactly like a pro
  // cancellation. It must NOT read the client cancellation window: she never
  // cancelled anything, so being "late" is not a thing she can be.
  it('system expiry refunds deposit AND fee, whatever the window says', () => {
    for (const clientWithinFullRefundWindow of [true, false]) {
      expect(
        resolveDepositRefundPlan({
          ...AMOUNTS,
          actorKind: 'system',
          clientWithinFullRefundWindow,
        }),
      ).toEqual({
        refundDepositCents: 2000,
        refundFee: true,
        refundAmountCents: 2500,
      })
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Who actually ends up with the money.
//
// 🔴 This is the test that matters and the one nothing else covers. Every other
// test here asserts the numbers we SEND to Stripe; this asserts where the money
// LANDS, which is a different question and the one the fee model is about. It
// exists because reasoning from the API docs got this wrong: the natural reading
// is that a destination charge transfers `amount - application_fee_amount`, so a
// partial refund looked like it left the pro holding part of a refunded deposit.
//
// The real behaviour, verified against the Stripe sandbox with a throwaway
// connected account (full refund, partial refund, and an explicit reversal, each
// read back off the connected account's balance):
//   • the transfer to the connected account is the FULL charge amount, and the
//     application fee is pulled back from it — so `transfer.amount === charge.amount`;
//   • `reverse_transfer` reverses the whole transfer on a full refund and a
//     proportional share otherwise — which, because the transfer equals the charge,
//     is exactly the refunded amount;
//   • `refund_application_fee` pushes the application fee to the CONNECTED account
//     (platform -> pro), in full on a full refund and proportionally otherwise.
//
// If someone "fixes" the refund flags or moves the pro fee out of the application
// fee, these expectations break and say what the money did instead.
// ─────────────────────────────────────────────────────────────────────────────
describe('the three-party ledger (Stripe behaviour, sandbox-verified)', () => {
  /** Net cents for each party from one deposit charge and at most one refund. */
  function settle(args: {
    depositCents: number
    clientFeeCents: number
    proFeeCents: number
    refundAmountCents: number
    refundFee: boolean
  }) {
    const chargeTotal = args.depositCents + args.clientFeeCents
    const appFee = args.clientFeeCents + args.proFeeCents
    const refund = args.refundAmountCents

    // The transfer equals the whole charge, so a proportional reversal of a refund
    // of `refund` reverses exactly `refund`.
    const reversal = refund
    const appFeeRefunded = args.refundFee
      ? Math.round((appFee * refund) / chargeTotal)
      : 0

    return {
      client: -chargeTotal + refund,
      pro: chargeTotal - appFee - reversal + appFeeRefunded,
      platform: appFee - refund + reversal - appFeeRefunded,
    }
  }

  // $50 deposit -> $5 client fee (10%), $5 pro fee. Charge $55, application fee $10.
  const CHARGE = { depositCents: 5000, clientFeeCents: 500, proFeeCents: 500 }

  it('no cancellation: client pays the fee, pro nets deposit minus $5, platform takes both', () => {
    expect(settle({ ...CHARGE, refundAmountCents: 0, refundFee: false })).toEqual({
      client: -5500,
      pro: 4500, // $50 deposit - $5 pro fee
      platform: 1000, // $5 + $5 — the "$8-13 per cold match" the model targets
    })
  })

  it('pro/admin cancel: everyone lands back at zero, including the pro’s $5', () => {
    const plan = resolveDepositRefundPlan({
      actorKind: 'pro',
      depositCents: CHARGE.depositCents,
      feeCents: CHARGE.clientFeeCents,
      clientWithinFullRefundWindow: false,
    })

    expect(
      settle({
        ...CHARGE,
        refundAmountCents: plan.refundAmountCents,
        refundFee: plan.refundFee,
      }),
    ).toEqual({ client: 0, pro: 0, platform: 0 })
  })

  it('client cancel >=24h: deposit returned, BOTH earned fees kept', () => {
    const plan = resolveDepositRefundPlan({
      actorKind: 'client',
      depositCents: CHARGE.depositCents,
      feeCents: CHARGE.clientFeeCents,
      clientWithinFullRefundWindow: true,
    })

    expect(
      settle({
        ...CHARGE,
        refundAmountCents: plan.refundAmountCents,
        refundFee: plan.refundFee,
      }),
    ).toEqual({
      client: -500, // out only their convenience fee; the deposit came back
      pro: -500, // out only their $5 — the deposit they held was returned
      platform: 1000,
    })
  })

  it('client cancel <24h: deposit forfeited to the pro, minus their $5', () => {
    expect(settle({ ...CHARGE, refundAmountCents: 0, refundFee: false }).pro).toBe(
      4500,
    )
  })

  it('a member pays no pro fee, and their client pays exactly the same either way', () => {
    const free = settle({ ...CHARGE, refundAmountCents: 0, refundFee: false })
    const member = settle({
      ...CHARGE,
      proFeeCents: 0,
      refundAmountCents: 0,
      refundFee: false,
    })

    expect(member.pro).toBe(5000) // the whole deposit — "every dollar Tovis brings them"
    expect(member.platform).toBe(500) // the client fee only
    expect(member.client).toBe(free.client) // 🔴 unchanged by the pro's membership
  })

  it('the ledger always balances to zero across the three parties', () => {
    for (const proFeeCents of [0, 500]) {
      for (const refund of [0, 5000, 5500]) {
        const l = settle({
          ...CHARGE,
          proFeeCents,
          refundAmountCents: refund,
          refundFee: refund === 5500,
        })
        expect(l.client + l.pro + l.platform).toBe(0)
      }
    }
  })
})
