// lib/booking/prepay.test.ts
//
// K10 (D4 = per-service prepay). The money rules that decide what a booking
// takes UP FRONT once a service can demand payment in full.

import { describe, expect, it } from 'vitest'
import { DepositType, OfferingPrepayScope } from '@prisma/client'

import type { DepositSettings } from '@/lib/booking/discoveryDepositPlan'
import {
  PREPAY_DEPOSIT_SETTINGS,
  computeUpfrontDepositCents,
  resolvePrepayCoveredCents,
} from '@/lib/booking/prepay'

const DISABLED: DepositSettings = {
  depositEnabled: false,
  depositType: DepositType.FLAT,
  depositFlatAmountCents: null,
  depositPercent: null,
}

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

describe('PREPAY_DEPOSIT_SETTINGS', () => {
  // Prepay reuses the deposit rail rather than adding a parallel money path, so
  // it has to be expressible in the deposit vocabulary.
  it('is exactly 100 percent, enabled', () => {
    expect(PREPAY_DEPOSIT_SETTINGS).toEqual({
      depositEnabled: true,
      depositType: DepositType.PERCENT,
      depositPercent: 100,
      depositFlatAmountCents: null,
    })
  })
})

describe('resolvePrepayCoveredCents', () => {
  it('covers nothing when the service demands no prepay', () => {
    expect(
      resolvePrepayCoveredCents({
        prepayScope: null,
        baseServiceCents: 10000,
        bookingTotalCents: 12000,
      }),
    ).toBe(0)
  })

  it('SERVICE_ONLY covers the base service and leaves add-ons on the final bill', () => {
    expect(
      resolvePrepayCoveredCents({
        prepayScope: OfferingPrepayScope.SERVICE_ONLY,
        baseServiceCents: 10000,
        bookingTotalCents: 12500, // base + a $25 add-on
      }),
    ).toBe(10000)
  })

  it('ENTIRE_BOOKING covers the whole bill, add-ons included', () => {
    expect(
      resolvePrepayCoveredCents({
        prepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
        baseServiceCents: 10000,
        bookingTotalCents: 12500,
      }),
    ).toBe(12500)
  })

  // 100% has to mean exactly the bill: sizing off the undiscounted base would
  // collect more than is owed and leave excess held on every discounted booking.
  it('never covers more than the bill when a discount lands below the base price', () => {
    expect(
      resolvePrepayCoveredCents({
        prepayScope: OfferingPrepayScope.SERVICE_ONLY,
        baseServiceCents: 10000,
        bookingTotalCents: 7000, // last-minute opening incentive
      }),
    ).toBe(7000)
  })

  it('covers nothing on a $0 bill', () => {
    for (const prepayScope of Object.values(OfferingPrepayScope)) {
      expect(
        resolvePrepayCoveredCents({
          prepayScope,
          baseServiceCents: 10000,
          bookingTotalCents: 0,
        }),
      ).toBe(0)
    }
  })
})

describe('computeUpfrontDepositCents', () => {
  describe('no prepay requirement — pre-K10 behaviour, unchanged', () => {
    it('sizes the pro’s flat deposit off the service subtotal', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: true,
          settings: FLAT_20,
          serviceSubtotalCents: 12500,
          prepayScope: null,
          baseServiceCents: 10000,
          bookingTotalCents: 12500,
        }),
      ).toBe(2000)
    })

    it('sizes the pro’s percentage deposit off the service subtotal', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: true,
          settings: PERCENT_25,
          serviceSubtotalCents: 12500,
          prepayScope: null,
          baseServiceCents: 10000,
          bookingTotalCents: 12500,
        }),
      ).toBe(3125)
    })

    it('collects nothing when the scope excludes this booking', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: false,
          settings: FLAT_20,
          serviceSubtotalCents: 12500,
          prepayScope: null,
          baseServiceCents: 10000,
          bookingTotalCents: 12500,
        }),
      ).toBe(0)
    })

    // 🔴 The ordinary deposit is deliberately NOT capped at the bill. A pro
    // whose flat deposit already exceeded a discounted total collected it that
    // way before K10 (K10-A reports the difference as excessHeldCents), and
    // K10 must not change what an untouched pro collects.
    it('leaves a flat deposit larger than the discounted bill exactly as it was', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: true,
          settings: FLAT_20,
          serviceSubtotalCents: 10000,
          prepayScope: null,
          baseServiceCents: 10000,
          bookingTotalCents: 1500, // heavily discounted
        }),
      ).toBe(2000)
    })
  })

  describe('prepay overrides the account-wide switch', () => {
    // Tori, 2026-07-30: a pro with deposits off who marks one service
    // prepay-required gets prepay on it.
    it('charges the full bill even with deposits DISABLED account-wide', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: false,
          settings: DISABLED,
          serviceSubtotalCents: 12500,
          prepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
          baseServiceCents: 10000,
          bookingTotalCents: 12500,
        }),
      ).toBe(12500)
    })

    it('charges only the base service under SERVICE_ONLY', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: false,
          settings: DISABLED,
          serviceSubtotalCents: 12500,
          prepayScope: OfferingPrepayScope.SERVICE_ONLY,
          baseServiceCents: 10000,
          bookingTotalCents: 12500,
        }),
      ).toBe(10000)
    })

    it('sizes the prepay against the DISCOUNTED total, so 100% means 100%', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: false,
          settings: DISABLED,
          serviceSubtotalCents: 12500,
          prepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
          baseServiceCents: 10000,
          bookingTotalCents: 9000, // last-minute incentive applied
        }),
      ).toBe(9000)
    })
  })

  describe('the two rules never stack', () => {
    // Adding them would charge 125% of a bill.
    it('takes the prepay, not prepay + the pro’s percentage deposit', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: true,
          settings: PERCENT_25,
          serviceSubtotalCents: 10000,
          prepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
          baseServiceCents: 10000,
          bookingTotalCents: 10000,
        }),
      ).toBe(10000)
    })

    // The other direction, and the reason max() is not just "prepay wins": a
    // cheap prepay-required base under expensive add-ons is genuinely smaller
    // than the deposit the pro configured, and marking a service prepay-required
    // must never REDUCE what that pro collects.
    it('keeps the larger ordinary deposit when SERVICE_ONLY would collect less', () => {
      expect(
        computeUpfrontDepositCents({
          scopeDepositRequired: true,
          settings: PERCENT_25,
          serviceSubtotalCents: 51000, // $10 base + $500 of add-ons
          prepayScope: OfferingPrepayScope.SERVICE_ONLY,
          baseServiceCents: 1000,
          bookingTotalCents: 51000,
        }),
      ).toBe(12750) // 25% of the subtotal, not the $10 base
    })
  })

  it('collects nothing on a $0 bill even under prepay', () => {
    expect(
      computeUpfrontDepositCents({
        scopeDepositRequired: false,
        settings: DISABLED,
        serviceSubtotalCents: 0,
        prepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
        baseServiceCents: 0,
        bookingTotalCents: 0,
      }),
    ).toBe(0)
  })
})
