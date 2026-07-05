// app/api/v1/pro/looks/analytics/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  loadCreatorLooksAnalytics: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/looks/creatorAnalytics', () => ({
  loadCreatorLooksAnalytics: mocks.loadCreatorLooksAnalytics,
}))

import { GET } from './route'

const SAMPLE = {
  publishedCount: 3,
  totals: { views: 120, likes: 40, comments: 8, saves: 15, shares: 4, bookings: 2 },
  followers: { total: 50, new30d: 6, weekly: [{ weeksAgo: 1, count: 3 }] },
  topLooks: [
    {
      lookPostId: 'lp1',
      caption: 'Balayage',
      thumbUrl: 'https://cdn/x.jpg',
      publishedAt: '2026-07-01T00:00:00.000Z',
      views: 90,
      likes: 30,
      comments: 5,
      saves: 10,
      shares: 3,
      bookings: 2,
      engagementScore: 42,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/pro/looks/analytics', () => {
  it('returns 401 res when not an authed pro', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: new Response('nope', { status: 401 }),
    })

    const res = await GET()
    expect(res.status).toBe(401)
    expect(mocks.loadCreatorLooksAnalytics).not.toHaveBeenCalled()
  })

  it('returns the creator analytics for the authed pro', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro-1',
      userId: 'u1',
      user: {},
    })
    mocks.loadCreatorLooksAnalytics.mockResolvedValue(SAMPLE)

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.analytics).toEqual(SAMPLE)
    expect(mocks.loadCreatorLooksAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId: 'pro-1' }),
    )
  })
})
