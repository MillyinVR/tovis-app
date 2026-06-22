// lib/nfc/nfcAnalytics.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NfcCardType, Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  referralCount: vi.fn(),
  cardFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    attributionEvent: { groupBy: mocks.groupBy },
    referral: { count: mocks.referralCount },
    nfcCard: { findMany: mocks.cardFindMany },
  },
}))

import { NFC_ATTRIBUTION_EVENT } from './attributionEvents'
import { getNfcAnalytics } from './nfcAnalytics'

describe('getNfcAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.length === 1) {
        return Promise.resolve([
          { eventType: NFC_ATTRIBUTION_EVENT.CARD_TAPPED, _count: { _all: 100 } },
          { eventType: NFC_ATTRIBUTION_EVENT.CARD_CLAIMED, _count: { _all: 20 } },
          { eventType: NFC_ATTRIBUTION_EVENT.TAP_EXISTING_CARD, _count: { _all: 5 } },
          { eventType: NFC_ATTRIBUTION_EVENT.CLAIM_RACE_LOST, _count: { _all: 1 } },
          { eventType: NFC_ATTRIBUTION_EVENT.CLAIM_TENANT_MISMATCH, _count: { _all: 2 } },
        ])
      }
      return Promise.resolve([
        { cardId: 'card_a', eventType: NFC_ATTRIBUTION_EVENT.CARD_TAPPED, _count: { _all: 40 } },
        { cardId: 'card_a', eventType: NFC_ATTRIBUTION_EVENT.CARD_CLAIMED, _count: { _all: 9 } },
        { cardId: 'card_b', eventType: NFC_ATTRIBUTION_EVENT.CARD_TAPPED, _count: { _all: 60 } },
      ])
    })

    mocks.referralCount.mockImplementation((args: { where: Prisma.ReferralWhereInput }) => {
      if (args.where.status) return Promise.resolve(8)
      if (args.where.convertedAt) return Promise.resolve(4)
      return Promise.resolve(12)
    })

    mocks.cardFindMany.mockResolvedValue([
      {
        id: 'card_a',
        shortCode: 'AAAA1111',
        type: NfcCardType.CLIENT_REFERRAL,
        isActive: true,
        referralCount: 3,
      },
      {
        id: 'card_b',
        shortCode: 'BBBB2222',
        type: NfcCardType.PRO_BOOKING,
        isActive: true,
        referralCount: 0,
      },
    ])
  })

  it('aggregates the funnel summary from attribution events and referrals', async () => {
    const { summary } = await getNfcAnalytics()

    expect(summary).toEqual({
      taps: 100,
      signups: 20,
      existingCardTaps: 5,
      raceLost: 1,
      tenantMismatch: 2,
      referralsCreated: 12,
      referralsConfirmed: 8,
      referralsConverted: 4,
    })
  })

  it('ranks top cards by taps then signups', async () => {
    const { topCards } = await getNfcAnalytics()

    expect(topCards.map((c) => c.cardId)).toEqual(['card_b', 'card_a'])
    expect(topCards[0]).toMatchObject({ cardId: 'card_b', taps: 60, signups: 0 })
    expect(topCards[1]).toMatchObject({ cardId: 'card_a', taps: 40, signups: 9, referralCount: 3 })
  })
})
