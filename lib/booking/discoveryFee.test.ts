import { describe, it, expect, afterEach } from 'vitest'
import { BookingDiscoveryProvenance } from '@prisma/client'

import {
  isNewDiscoveryClient,
  isDiscoveryProvenance,
  computeClientConvenienceFeeCents,
  computePlatformFees,
  platformFeesEnabled,
  PRO_DISCOVERY_FEE_CENTS,
  type DiscoveryClientSignals,
} from '@/lib/booking/discoveryFee'

// A brand-new cold-discovery client with a deposit-enabled, Stripe-ready pro: the
// canonical "charge the fee" case. Individual tests override single fields.
const NEW_DISCOVERY: DiscoveryClientSignals = {
  provenance: BookingDiscoveryProvenance.LOOKS_FEED,
  proDepositEnabled: true,
  proStripeReady: true,
  establishedBookingCount: 0,
  acceptedInviteCount: 0,
  threadCount: 0,
  arrivedViaProNfc: false,
}

describe('isNewDiscoveryClient', () => {
  it('charges a brand-new client found via the Looks feed', () => {
    expect(isNewDiscoveryClient(NEW_DISCOVERY)).toBe(true)
  })

  it('charges a brand-new client found via the Discovery tab', () => {
    expect(
      isNewDiscoveryClient({
        ...NEW_DISCOVERY,
        provenance: BookingDiscoveryProvenance.DISCOVERY_SEARCH,
      }),
    ).toBe(true)
  })

  it('exempts non-discovery provenance (direct, name search, NFC, aftercare, unknown)', () => {
    for (const provenance of [
      BookingDiscoveryProvenance.DIRECT_PROFILE,
      BookingDiscoveryProvenance.NAME_SEARCH,
      BookingDiscoveryProvenance.NFC,
      BookingDiscoveryProvenance.AFTERCARE,
      BookingDiscoveryProvenance.PRO_CREATED,
      BookingDiscoveryProvenance.UNKNOWN,
    ]) {
      expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, provenance })).toBe(false)
    }
  })

  it('exempts when the pro has no deposit enabled', () => {
    expect(
      isNewDiscoveryClient({ ...NEW_DISCOVERY, proDepositEnabled: false }),
    ).toBe(false)
  })

  it('does not charge when the pro cannot take a platform charge (not Stripe-ready)', () => {
    expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, proStripeReady: false })).toBe(false)
  })

  it('exempts a returning client with an established (non-refunded) booking', () => {
    expect(
      isNewDiscoveryClient({ ...NEW_DISCOVERY, establishedBookingCount: 1 }),
    ).toBe(false)
  })

  it('exempts a client on the pro roster (accepted invite)', () => {
    expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, acceptedInviteCount: 1 })).toBe(false)
  })

  it('exempts a client who has messaged the pro', () => {
    expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, threadCount: 1 })).toBe(false)
  })

  it('exempts a client who arrived via the pro NFC card', () => {
    expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, arrivedViaProNfc: true })).toBe(false)
  })

  it('re-charges after a refund reset: a cancelled+refunded prior booking does NOT establish the relationship', () => {
    // The caller excludes fee-refunded cancellations from establishedBookingCount, so
    // the only prior contact (a refunded discovery booking) leaves the pair "new".
    expect(
      isNewDiscoveryClient({
        ...NEW_DISCOVERY,
        establishedBookingCount: 0, // refunded booking excluded by the query
        acceptedInviteCount: 0,
        threadCount: 0,
      }),
    ).toBe(true)
  })
})

describe('computeClientConvenienceFeeCents — 10% of the deposit, floor $2, cap $10', () => {
  it('takes 10% between the floor and the cap', () => {
    expect(computeClientConvenienceFeeCents(5000)).toBe(500) // $50 -> $5
    expect(computeClientConvenienceFeeCents(3000)).toBe(300) // $30 -> $3
    expect(computeClientConvenienceFeeCents(7500)).toBe(750) // $75 -> $7.50
  })

  // ── the FLOOR boundary, from both sides ──────────────────────────────────
  it('floors at $2 below a $20 deposit', () => {
    expect(computeClientConvenienceFeeCents(1)).toBe(200)
    expect(computeClientConvenienceFeeCents(1000)).toBe(200) // $10 -> 10% is $1
    expect(computeClientConvenienceFeeCents(1999)).toBe(200) // 10% = $2.00 (rounded) but still floored
  })

  it('meets the floor exactly at a $20 deposit and rises above it after', () => {
    expect(computeClientConvenienceFeeCents(2000)).toBe(200) // exactly the floor
    expect(computeClientConvenienceFeeCents(2010)).toBe(201) // first cent above it
  })

  // ── the CAP boundary, from both sides ────────────────────────────────────
  it('meets the cap exactly at a $100 deposit and never exceeds it', () => {
    expect(computeClientConvenienceFeeCents(9990)).toBe(999) // just under
    expect(computeClientConvenienceFeeCents(10000)).toBe(1000) // exactly the cap
    expect(computeClientConvenienceFeeCents(10010)).toBe(1000) // first cent over
    expect(computeClientConvenienceFeeCents(100000)).toBe(1000) // $1000 deposit
    expect(computeClientConvenienceFeeCents(10_000_000)).toBe(1000)
  })

  it('is zero with no deposit, and never negative', () => {
    expect(computeClientConvenienceFeeCents(0)).toBe(0)
    expect(computeClientConvenienceFeeCents(-5000)).toBe(0)
  })

  it('never exceeds the deposit it is a percentage of, above the floor', () => {
    for (const deposit of [2000, 2500, 5000, 9999, 10000, 50000]) {
      expect(computeClientConvenienceFeeCents(deposit)).toBeLessThanOrEqual(deposit)
    }
  })
})

describe('computePlatformFees — the two-fee split', () => {
  const ON = { feeEligible: true, feesEnabled: true, proFeeWaived: false }

  it('charges the client 10% and the pro a flat $5 on a cold match', () => {
    expect(computePlatformFees({ depositCents: 5000, ...ON })).toEqual({
      clientFeeCents: 500,
      proFeeCents: PRO_DISCOVERY_FEE_CENTS,
      proFeeWaived: false,
    })
  })

  it('the pro fee is FLAT — it does not scale with the deposit', () => {
    for (const deposit of [2000, 5000, 20000, 100000]) {
      expect(
        computePlatformFees({ depositCents: deposit, ...ON }).proFeeCents,
      ).toBe(PRO_DISCOVERY_FEE_CENTS)
    }
  })

  // 🔴 Stripe caps application_fee_amount at the charge total, and the pro's payout
  // IS the deposit — we can never collect more than it exists to take.
  it('clamps the pro fee to a deposit smaller than $5', () => {
    expect(computePlatformFees({ depositCents: 500, ...ON }).proFeeCents).toBe(500)
    expect(computePlatformFees({ depositCents: 300, ...ON }).proFeeCents).toBe(300)
    expect(computePlatformFees({ depositCents: 100, ...ON }).proFeeCents).toBe(100)
  })

  it('the application fee can never exceed the charge the customer is billed', () => {
    for (const deposit of [100, 300, 500, 2000, 5000, 100000]) {
      const fees = computePlatformFees({ depositCents: deposit, ...ON })
      const chargeTotal = deposit + fees.clientFeeCents
      expect(fees.clientFeeCents + fees.proFeeCents).toBeLessThanOrEqual(chargeTotal)
    }
  })

  // ── every "no fee" path ──────────────────────────────────────────────────
  it('charges nothing when the client is not a cold match (rebook / direct link)', () => {
    expect(
      computePlatformFees({ depositCents: 5000, ...ON, feeEligible: false }),
    ).toEqual({ clientFeeCents: 0, proFeeCents: 0, proFeeWaived: false })
  })

  it('charges nothing while ENABLE_PLATFORM_FEES is off', () => {
    expect(
      computePlatformFees({ depositCents: 5000, ...ON, feesEnabled: false }),
    ).toEqual({ clientFeeCents: 0, proFeeCents: 0, proFeeWaived: false })
  })

  it('charges nothing when there is no deposit to take a fee from', () => {
    expect(computePlatformFees({ depositCents: 0, ...ON })).toEqual({
      clientFeeCents: 0,
      proFeeCents: 0,
      proFeeWaived: false,
    })
  })

  // ── the membership waiver: PRO side only ─────────────────────────────────
  it("a member's waiver zeroes the pro fee and leaves the client fee UNTOUCHED", () => {
    const free = computePlatformFees({ depositCents: 5000, ...ON })
    const member = computePlatformFees({
      depositCents: 5000,
      ...ON,
      proFeeWaived: true,
    })

    expect(member.proFeeCents).toBe(0)
    expect(member.proFeeWaived).toBe(true)
    // The client pays exactly the same either way — a pro's subscription must
    // never change what their client is billed.
    expect(member.clientFeeCents).toBe(free.clientFeeCents)
    expect(member.clientFeeCents).toBe(500)
  })

  it('does not report a waiver when there was no fee to waive', () => {
    // Flag off: nothing was waived, the fees were simply never charged. This keeps
    // the measurement cohorts honest — proDiscoveryFeeWaived must mean "a member
    // avoided a real charge", not "no charge happened".
    expect(
      computePlatformFees({
        depositCents: 5000,
        feeEligible: true,
        feesEnabled: false,
        proFeeWaived: true,
      }).proFeeWaived,
    ).toBe(false)

    // Not a cold match: likewise nothing to waive.
    expect(
      computePlatformFees({
        depositCents: 5000,
        feeEligible: false,
        feesEnabled: true,
        proFeeWaived: true,
      }).proFeeWaived,
    ).toBe(false)
  })
})

// The eligibility gate and the money are two functions; what Tori's spec actually
// promises is the COMPOSITION of them — "returning clients, rebooks, direct links:
// never any fee". Asserting `isNewDiscoveryClient === false` alone would not catch a
// fee that got charged anyway, so these run the signals all the way to the amounts.
describe('once per pair, cold discovery only — end to end to the amounts', () => {
  const feesFor = (signals: DiscoveryClientSignals) =>
    computePlatformFees({
      depositCents: 5000,
      feeEligible: isNewDiscoveryClient(signals),
      feesEnabled: true,
      proFeeWaived: false,
    })

  const ZERO = { clientFeeCents: 0, proFeeCents: 0, proFeeWaived: false }

  it('charges both fees on the FIRST cold-discovery booking', () => {
    expect(feesFor(NEW_DISCOVERY)).toEqual({
      clientFeeCents: 500,
      proFeeCents: 500,
      proFeeWaived: false,
    })
  })

  it('charges NOTHING on the second booking with the same pro', () => {
    expect(feesFor({ ...NEW_DISCOVERY, establishedBookingCount: 1 })).toEqual(ZERO)
    expect(feesFor({ ...NEW_DISCOVERY, establishedBookingCount: 9 })).toEqual(ZERO)
  })

  it('charges NOTHING on a direct-link / profile booking', () => {
    expect(
      feesFor({
        ...NEW_DISCOVERY,
        provenance: BookingDiscoveryProvenance.DIRECT_PROFILE,
      }),
    ).toEqual(ZERO)
  })

  it('charges NOTHING on a rebook, a name search, an NFC tap or an unknown path', () => {
    for (const provenance of [
      BookingDiscoveryProvenance.AFTERCARE,
      BookingDiscoveryProvenance.NAME_SEARCH,
      BookingDiscoveryProvenance.NFC,
      BookingDiscoveryProvenance.PRO_CREATED,
      BookingDiscoveryProvenance.UNKNOWN,
    ]) {
      expect(feesFor({ ...NEW_DISCOVERY, provenance })).toEqual(ZERO)
    }
  })

  it('charges NOTHING when any other prior-relationship signal is present', () => {
    expect(feesFor({ ...NEW_DISCOVERY, acceptedInviteCount: 1 })).toEqual(ZERO)
    expect(feesFor({ ...NEW_DISCOVERY, threadCount: 1 })).toEqual(ZERO)
    expect(feesFor({ ...NEW_DISCOVERY, arrivedViaProNfc: true })).toEqual(ZERO)
  })
})

describe('platformFeesEnabled', () => {
  const original = process.env.ENABLE_PLATFORM_FEES
  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_PLATFORM_FEES
    else process.env.ENABLE_PLATFORM_FEES = original
  })

  it('is OFF unless explicitly switched on — the money default is "charge nothing"', () => {
    delete process.env.ENABLE_PLATFORM_FEES
    expect(platformFeesEnabled()).toBe(false)

    for (const v of ['', '0', 'false', 'no', 'off', 'maybe', 'TRUEISH']) {
      process.env.ENABLE_PLATFORM_FEES = v
      expect(platformFeesEnabled()).toBe(false)
    }
  })

  it('is on for the affirmative values, case- and space-insensitive', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', ' Yes ']) {
      process.env.ENABLE_PLATFORM_FEES = v
      expect(platformFeesEnabled()).toBe(true)
    }
  })
})
