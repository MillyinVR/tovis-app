// app/api/v1/pro/referrals/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  loadProReferralActivity: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/referral/proReferralActivity', () => ({
  loadProReferralActivity: mocks.loadProReferralActivity,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/pro/referrals', () => {
  it('returns 401 res when not an authed pro', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: new Response('nope', { status: 401 }),
    })

    const res = await GET()
    expect(res.status).toBe(401)
    expect(mocks.loadProReferralActivity).not.toHaveBeenCalled()
  })

  it('serializes Date fields to ISO strings in the JSON contract', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro-1',
      userId: 'u1',
      user: {},
    })
    mocks.loadProReferralActivity.mockResolvedValue({
      summary: { total: 2, rewarded: 1, creditDollarsApplied: 20 },
      rows: [
        {
          id: 'r1',
          status: 'REWARDED',
          createdAt: new Date('2026-06-01T12:00:00.000Z'),
          convertedAt: new Date('2026-06-10T09:30:00.000Z'),
          rewardTier: 'CREDIT',
          rewardValue: 20,
          rewardApplied: true,
          referrerName: 'Ada',
          referredName: 'Grace',
          cardShortCode: 'ABCD1234',
        },
        {
          id: 'r2',
          status: 'CONVERTED',
          createdAt: new Date('2026-06-05T00:00:00.000Z'),
          convertedAt: null,
          rewardTier: null,
          rewardValue: null,
          rewardApplied: false,
          referrerName: 'Bo',
          referredName: 'Cleo',
          cardShortCode: null,
        },
      ],
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.summary).toEqual({ total: 2, rewarded: 1, creditDollarsApplied: 20 })
    expect(body.rows[0].createdAt).toBe('2026-06-01T12:00:00.000Z')
    expect(body.rows[0].convertedAt).toBe('2026-06-10T09:30:00.000Z')
    expect(body.rows[0].referrerName).toBe('Ada')
    expect(body.rows[1].convertedAt).toBeNull()
  })
})
