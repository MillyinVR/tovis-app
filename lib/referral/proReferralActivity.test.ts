// lib/referral/proReferralActivity.test.ts
import { ReferralRewardTier, ReferralStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  referralFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    referral: {
      findMany: mocks.referralFindMany,
    },
  },
}))

import {
  assembleProReferralActivity,
  loadProReferralActivity,
  type RawProReferral,
} from './proReferralActivity'

beforeEach(() => {
  vi.clearAllMocks()
})

function raw(overrides: Partial<RawProReferral> = {}): RawProReferral {
  return {
    id: 'ref_1',
    status: ReferralStatus.CONVERTED,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    convertedAt: new Date('2026-06-05T00:00:00Z'),
    rewardTier: null,
    rewardValue: null,
    rewardAppliedAt: null,
    referrerFirstName: 'Ada',
    referredFirstName: 'Grace',
    cardShortCode: null,
    ...overrides,
  }
}

describe('assembleProReferralActivity', () => {
  it('summarizes totals, rewards applied, and credit dollars', () => {
    const result = assembleProReferralActivity([
      raw({ id: 'a' }),
      raw({
        id: 'b',
        status: ReferralStatus.REWARDED,
        rewardTier: ReferralRewardTier.CREDIT,
        rewardValue: 10,
        rewardAppliedAt: new Date('2026-06-10T00:00:00Z'),
      }),
      raw({
        id: 'c',
        status: ReferralStatus.REWARDED,
        rewardTier: ReferralRewardTier.DISCOUNT,
        rewardValue: 15,
        rewardAppliedAt: new Date('2026-06-11T00:00:00Z'),
      }),
    ])

    expect(result.summary.total).toBe(3)
    expect(result.summary.rewarded).toBe(2)
    // Only CREDIT tier contributes dollars; DISCOUNT (a percent) does not.
    expect(result.summary.creditDollarsApplied).toBe(10)
    expect(result.rows).toHaveLength(3)
  })

  it('marks rewardApplied from rewardAppliedAt and resolves names', () => {
    const row = assembleProReferralActivity([
      raw({ rewardAppliedAt: new Date('2026-06-10T00:00:00Z') }),
    ]).rows[0]!

    expect(row.rewardApplied).toBe(true)
    expect(row.referrerName).toBe('Ada')
    expect(row.referredName).toBe('Grace')
  })

  it('falls back to a neutral label when a first name is missing', () => {
    const row = assembleProReferralActivity([
      raw({ referrerFirstName: null, referredFirstName: '  ' }),
    ]).rows[0]!

    expect(row.referrerName).toBe('A client')
    expect(row.referredName).toBe('A client')
  })

  it('produces a zeroed summary for no referrals', () => {
    const result = assembleProReferralActivity([])
    expect(result.summary).toEqual({
      total: 0,
      rewarded: 0,
      creditDollarsApplied: 0,
    })
    expect(result.rows).toEqual([])
  })
})

describe('loadProReferralActivity', () => {
  it('queries referrals credited to the pro and normalizes Decimal reward values', async () => {
    mocks.referralFindMany.mockResolvedValue([
      {
        id: 'ref_1',
        status: ReferralStatus.REWARDED,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        convertedAt: new Date('2026-06-05T00:00:00Z'),
        rewardTier: ReferralRewardTier.CREDIT,
        rewardValue: { toString: () => '10.00' }, // Prisma Decimal-like
        rewardAppliedAt: new Date('2026-06-10T00:00:00Z'),
        referrerClient: { firstName: 'Ada' },
        referredClient: { firstName: 'Grace' },
        nfcCard: { shortCode: 'ABC123' },
      },
    ])

    const result = await loadProReferralActivity({ professionalId: 'pro_1' })

    expect(mocks.referralFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro_1' },
      }),
    )
    expect(result.rows[0]!.rewardValue).toBe(10)
    expect(result.rows[0]!.cardShortCode).toBe('ABC123')
    expect(result.summary.creditDollarsApplied).toBe(10)
  })

  it('handles null client relations and missing card', async () => {
    mocks.referralFindMany.mockResolvedValue([
      {
        id: 'ref_2',
        status: ReferralStatus.CONVERTED,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        convertedAt: null,
        rewardTier: null,
        rewardValue: null,
        rewardAppliedAt: null,
        referrerClient: null,
        referredClient: null,
        nfcCard: null,
      },
    ])

    const result = await loadProReferralActivity({ professionalId: 'pro_1' })
    expect(result.rows[0]!.referrerName).toBe('A client')
    expect(result.rows[0]!.cardShortCode).toBeNull()
  })
})
