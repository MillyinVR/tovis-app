// lib/booking/resolveDiscoveryFinalize.feeWaiver.test.ts
//
// Membership discovery-fee waiver (Option 1): a subscribed pro's brand-new
// discovery client pays NO platform fee while enforcement is on — the deposit
// still applies (feeEligible stands), only discoveryFeeCents is zeroed.
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
  },
}))

import { resolveDiscoveryFinalize } from './resolveDiscoveryFinalize'

const BASE = {
  clientId: 'client_1',
  clientUserId: null,
  professionalId: 'pro_1',
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

describe('resolveDiscoveryFinalize — membership discovery-fee waiver', () => {
  const priorFlag = process.env.ENABLE_MEMBERSHIP_ENFORCEMENT

  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset())
    arrangeColdDiscoveryMatch()
  })

  afterEach(() => {
    if (priorFlag === undefined) {
      delete process.env.ENABLE_MEMBERSHIP_ENFORCEMENT
    } else {
      process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = priorFlag
    }
  })

  it('subscribed pro + enforcement on → fee 0, still feeEligible (deposit stands)', async () => {
    process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = '1'
    mocks.subscriptionFindUnique.mockResolvedValue({
      planKey: 'pro',
      status: SubscriptionStatus.ACTIVE,
    })

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.feeEligible).toBe(true)
    expect(result.discoveryFeeCents).toBe(0)
  })

  it('free pro + enforcement on → fee unchanged', async () => {
    process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = '1'
    mocks.subscriptionFindUnique.mockResolvedValue(null)

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.feeEligible).toBe(true)
    expect(result.discoveryFeeCents).toBeGreaterThan(0)
  })

  it('lapsed subscription + enforcement on → fee unchanged', async () => {
    process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = '1'
    mocks.subscriptionFindUnique.mockResolvedValue({
      planKey: 'pro',
      status: SubscriptionStatus.PAST_DUE,
    })

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.discoveryFeeCents).toBeGreaterThan(0)
  })

  it('subscribed pro + enforcement OFF → fee unchanged (flag is the master switch)', async () => {
    delete process.env.ENABLE_MEMBERSHIP_ENFORCEMENT
    mocks.subscriptionFindUnique.mockResolvedValue({
      planKey: 'pro',
      status: SubscriptionStatus.ACTIVE,
    })

    const result = await resolveDiscoveryFinalize(BASE)

    expect(result.discoveryFeeCents).toBeGreaterThan(0)
  })
})
