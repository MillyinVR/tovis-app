import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  referralFindMany: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/lib/prisma', () => ({
  prismaRead: {
    referral: { findMany: mocks.referralFindMany },
  },
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client-1' })
  mocks.jsonOk.mockImplementation((data: unknown) => data)
  mocks.jsonFail.mockImplementation((status: number, error: string) => ({
    ok: false,
    status,
    error,
  }))
})

describe('GET /api/v1/client/referrals', () => {
  it('returns the auth failure response when not a client', async () => {
    const failRes = new Response('no', { status: 403 })
    mocks.requireClient.mockResolvedValueOnce({ ok: false, res: failRes })

    const res = await GET()

    expect(res).toBe(failRes)
    expect(mocks.referralFindMany).not.toHaveBeenCalled()
  })

  it('returns referrals for the authed client', async () => {
    mocks.referralFindMany.mockResolvedValue([
      {
        id: 'ref-1',
        status: 'CONFIRMED',
        expiresAt: new Date('2026-06-24T00:00:00Z'),
        confirmedAt: new Date('2026-06-17T12:00:00Z'),
        convertedAt: null,
        rewardTier: null,
        rewardValue: null,
        rewardAppliedAt: null,
        createdAt: new Date('2026-06-17T00:00:00Z'),
        referredClient: { firstName: 'Maya', avatarUrl: null },
        professional: null,
      },
    ])

    const raw: unknown = await GET()
    const payload = raw as {
      referrals: { id: string; referredFirstName: string; status: string }[]
    }

    expect(payload.referrals).toHaveLength(1)
    expect(payload.referrals[0]?.id).toBe('ref-1')
    expect(payload.referrals[0]?.referredFirstName).toBe('Maya')
    expect(payload.referrals[0]?.status).toBe('CONFIRMED')
  })

  it('marks expired PENDING referrals as EXPIRED in the response', async () => {
    mocks.referralFindMany.mockResolvedValue([
      {
        id: 'ref-2',
        status: 'PENDING',
        expiresAt: new Date('2020-01-01T00:00:00Z'),
        confirmedAt: null,
        convertedAt: null,
        rewardTier: null,
        rewardValue: null,
        rewardAppliedAt: null,
        createdAt: new Date('2019-12-25T00:00:00Z'),
        referredClient: { firstName: '', avatarUrl: null },
        professional: null,
      },
    ])

    const raw: unknown = await GET()
    const payload = raw as {
      referrals: { id: string; status: string; referredFirstName: string }[]
    }

    expect(payload.referrals[0]?.status).toBe('EXPIRED')
    expect(payload.referrals[0]?.referredFirstName).toBe('Someone')
  })

  it('returns a 500 fail payload when the query throws', async () => {
    mocks.referralFindMany.mockRejectedValue(new Error('db down'))

    const res = (await GET()) as { ok: boolean; status: number }

    expect(res.status).toBe(500)
    expect(mocks.jsonFail).toHaveBeenCalledWith(
      500,
      'Failed to load referrals.',
    )
  })
})
