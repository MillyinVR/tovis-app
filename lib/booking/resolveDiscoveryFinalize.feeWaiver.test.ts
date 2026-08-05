// lib/booking/resolveDiscoveryFinalize.feeWaiver.test.ts
//
// Membership pro-fee waiver: a subscribed pro pays NO $5 cold-match fee while the
// platform fees are live AND enforcement is on. The deposit still applies
// (feeEligible stands), and the CLIENT's convenience fee is never touched — the
// waiver is resolved here and the amounts follow from it in the deposit plan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingSource, DepositType, SubscriptionStatus } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  lookPostFindUnique: vi.fn(),
  mediaAssetFindUnique: vi.fn(),
  attributionEventFindFirst: vi.fn(),
  bookingCount: vi.fn(),
  proClientInviteCount: vi.fn(),
  messageThreadCount: vi.fn(),
  paymentSettingsFindUnique: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  offeringFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lookPost: { findUnique: mocks.lookPostFindUnique },
    mediaAsset: { findUnique: mocks.mediaAssetFindUnique },
    attributionEvent: { findFirst: mocks.attributionEventFindFirst },
    booking: { count: mocks.bookingCount },
    proClientInvite: { count: mocks.proClientInviteCount },
    messageThread: { count: mocks.messageThreadCount },
    professionalPaymentSettings: { findUnique: mocks.paymentSettingsFindUnique },
    professionalSubscription: { findUnique: mocks.subscriptionFindUnique },
    professionalServiceOffering: { findFirst: mocks.offeringFindFirst },
    // K16: resolveDiscoveryFinalize now reads this pro's policy for this
    // client. No row = every default, which is what these fixtures assume.
    proClientPolicy: { findUnique: async () => null },
  },
}))

import { resolveDiscoveryFinalize } from './resolveDiscoveryFinalize'

const BASE = {
  clientId: 'client_1',
  clientUserId: null,
  professionalId: 'pro_1',
  offeringId: 'offering_1',
  lookPostId: null,
  mediaId: null,
  source: BookingSource.DISCOVERY,
  aftercare: false,
}

const STRIPE_READY_DEPOSIT_SETTINGS = {
  depositEnabled: true,
  depositType: DepositType.FLAT,
  depositFlatAmount: 20,
  depositPercent: null,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
}

// A cold DISCOVERY_SEARCH match: attribution event present, no relationship.
function arrangeColdDiscoveryMatch() {
  mocks.lookPostFindUnique.mockResolvedValue(null)
  mocks.mediaAssetFindUnique.mockResolvedValue(null)
  mocks.attributionEventFindFirst.mockResolvedValue({
    metaJson: {
      clientId: 'client_1',
      professionalId: 'pro_1',
      kind: 'DISCOVERY_SEARCH',
    },
  })
  mocks.bookingCount.mockResolvedValue(0)
  mocks.proClientInviteCount.mockResolvedValue(0)
  mocks.messageThreadCount.mockResolvedValue(0)
  mocks.paymentSettingsFindUnique.mockResolvedValue(
    STRIPE_READY_DEPOSIT_SETTINGS,
  )
}

describe('resolveDiscoveryFinalize — membership pro-fee waiver', () => {
  const priorEnforcement = process.env.ENABLE_MEMBERSHIP_ENFORCEMENT
  const priorFees = process.env.ENABLE_PLATFORM_FEES

  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset())
    arrangeColdDiscoveryMatch()
    // Most cases here are about the WAIVER, so put the fees live; the two cases
    // that test the fee flag itself override this.
    process.env.ENABLE_PLATFORM_FEES = '1'
  })

  afterEach(() => {
    const restore = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    restore('ENABLE_MEMBERSHIP_ENFORCEMENT', priorEnforcement)
    restore('ENABLE_PLATFORM_FEES', priorFees)
  })

  const subscribed = () =>
    mocks.subscriptionFindUnique.mockResolvedValue({
      planKey: 'pro',
      status: SubscriptionStatus.ACTIVE,
    })

  it('subscribed pro + both flags on → pro fee waived, still feeEligible (deposit stands)', async () => {
    process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = '1'
    subscribed()

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.feeEligible).toBe(true)
    expect(result.feesEnabled).toBe(true)
    expect(result.proFeeWaived).toBe(true)
  })

  it('free pro + enforcement on → no waiver', async () => {
    process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = '1'
    mocks.subscriptionFindUnique.mockResolvedValue(null)

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.feeEligible).toBe(true)
    expect(result.proFeeWaived).toBe(false)
  })

  it('lapsed subscription + enforcement on → no waiver', async () => {
    process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = '1'
    mocks.subscriptionFindUnique.mockResolvedValue({
      planKey: 'pro',
      status: SubscriptionStatus.PAST_DUE,
    })

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.proFeeWaived).toBe(false)
  })

  it('subscribed pro + enforcement OFF → no waiver (enforcement is a master switch)', async () => {
    delete process.env.ENABLE_MEMBERSHIP_ENFORCEMENT
    subscribed()

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.proFeeWaived).toBe(false)
  })

  // 🔴 The waiver needs BOTH switches. With the fees off there is no pro fee to
  // waive, and reporting one would make a member look like they dodged a charge
  // nobody was charged — poisoning the very cohort the instrumentation exists for.
  it('subscribed pro + platform fees OFF → no waiver reported', async () => {
    process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = '1'
    delete process.env.ENABLE_PLATFORM_FEES
    subscribed()

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.feesEnabled).toBe(false)
    expect(result.proFeeWaived).toBe(false)
  })

  it('reports feesEnabled straight off the flag', async () => {
    delete process.env.ENABLE_PLATFORM_FEES
    mocks.subscriptionFindUnique.mockResolvedValue(null)
    expect((await resolveDiscoveryFinalize(BASE)).feesEnabled).toBe(false)

    process.env.ENABLE_PLATFORM_FEES = 'true'
    expect((await resolveDiscoveryFinalize(BASE)).feesEnabled).toBe(true)
  })
})
