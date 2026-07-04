// lib/looks/creatorAnalytics.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    lookPost: { aggregate: vi.fn(), findMany: vi.fn() },
    proFollow: { count: vi.fn(), findMany: vi.fn() },
    booking: { groupBy: vi.fn(), count: vi.fn() },
  },
  renderMediaUrls: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

import {
  assembleCreatorLooksAnalytics,
  bucketFollowerGrowth,
  computeLookEngagementScore,
  countRecentFollowers,
  loadCreatorLooksAnalytics,
  type CreatorLookCandidate,
} from './creatorAnalytics'

const NOW = new Date('2026-07-04T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY

describe('computeLookEngagementScore', () => {
  it('weights outcomes above raw reach', () => {
    const views = computeLookEngagementScore({
      views: 100,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      bookings: 0,
    })
    const oneBooking = computeLookEngagementScore({
      views: 0,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      bookings: 1,
    })
    // 100 views (score 10) is beaten by a single booking (score 8)? No — but a
    // booking outweighs 100 views on a per-event basis massively.
    expect(views).toBeCloseTo(10)
    expect(oneBooking).toBeCloseTo(8)
    // A save (3) beats a like (1) beats a fractional view (0.1).
    const like = computeLookEngagementScore({
      views: 0, likes: 1, comments: 0, saves: 0, shares: 0, bookings: 0,
    })
    const save = computeLookEngagementScore({
      views: 0, likes: 0, comments: 0, saves: 1, shares: 0, bookings: 0,
    })
    expect(save).toBeGreaterThan(like)
  })
})

describe('bucketFollowerGrowth', () => {
  it('returns exactly `weeks` buckets oldest → newest', () => {
    const buckets = bucketFollowerGrowth([], NOW, 8)
    expect(buckets).toHaveLength(8)
    expect(buckets[0]?.weeksAgo).toBe(7)
    expect(buckets[7]?.weeksAgo).toBe(0)
    expect(buckets.every((b) => b.count === 0)).toBe(true)
  })

  it('drops instants into the right trailing week', () => {
    const dates = [
      new Date(NOW.getTime() - 1 * DAY), // this week (weeksAgo 0)
      new Date(NOW.getTime() - 8 * DAY), // ~1 week ago
      new Date(NOW.getTime() - 8 * DAY),
      new Date(NOW.getTime() - 20 * WEEK), // outside the window → ignored
    ]
    const buckets = bucketFollowerGrowth(dates, NOW, 8)
    const current = buckets.find((b) => b.weeksAgo === 0)
    const oneAgo = buckets.find((b) => b.weeksAgo === 1)
    expect(current?.count).toBe(1)
    expect(oneAgo?.count).toBe(2)
    const total = buckets.reduce((sum, b) => sum + b.count, 0)
    expect(total).toBe(3) // the 20-week-old follower is excluded
  })

  it('counts clock-skewed future instants in the current week', () => {
    const buckets = bucketFollowerGrowth(
      [new Date(NOW.getTime() + DAY)],
      NOW,
      4,
    )
    expect(buckets.find((b) => b.weeksAgo === 0)?.count).toBe(1)
  })
})

describe('countRecentFollowers', () => {
  it('counts only instants within the trailing window', () => {
    const dates = [
      new Date(NOW.getTime() - 5 * DAY),
      new Date(NOW.getTime() - 29 * DAY),
      new Date(NOW.getTime() - 31 * DAY),
    ]
    expect(countRecentFollowers(dates, NOW, 30)).toBe(2)
  })
})

describe('assembleCreatorLooksAnalytics', () => {
  function candidate(
    overrides: Partial<CreatorLookCandidate> & { id: string },
  ): CreatorLookCandidate {
    return {
      caption: null,
      thumbUrl: null,
      publishedAt: new Date('2026-07-01T00:00:00.000Z'),
      views: 0,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      bookings: 0,
      ...overrides,
    }
  }

  it('ranks top looks by engagement (bookings win) and caps the list', () => {
    const candidates = [
      candidate({ id: 'viral-views', views: 5000 }),
      candidate({ id: 'booked', bookings: 3 }),
      candidate({ id: 'liked', likes: 10 }),
    ]
    const result = assembleCreatorLooksAnalytics({
      publishedCount: 3,
      totals: {
        views: 5000, likes: 10, comments: 0, saves: 0, shares: 0, bookings: 3,
      },
      followerTotal: 12,
      followerCreatedAts: [new Date(NOW.getTime() - 2 * DAY)],
      candidates,
      now: NOW,
    })

    // viral-views: 5000*0.1 = 500 → still the top by score, but booked/liked ordered by score.
    expect(result.topLooks[0]?.lookPostId).toBe('viral-views')
    expect(result.topLooks.map((l) => l.lookPostId)).toEqual([
      'viral-views',
      'booked',
      'liked',
    ])
    expect(result.followers.total).toBe(12)
    expect(result.followers.new30d).toBe(1)
    expect(result.publishedCount).toBe(3)
  })

  it('serializes publishedAt and passes through per-look counts', () => {
    const result = assembleCreatorLooksAnalytics({
      publishedCount: 1,
      totals: {
        views: 1, likes: 2, comments: 3, saves: 4, shares: 5, bookings: 6,
      },
      followerTotal: 0,
      followerCreatedAts: [],
      candidates: [
        candidate({
          id: 'a',
          caption: 'balayage',
          views: 1, likes: 2, comments: 3, saves: 4, shares: 5, bookings: 6,
        }),
      ],
      now: NOW,
    })
    const look = result.topLooks[0]
    expect(look?.publishedAt).toBe('2026-07-01T00:00:00.000Z')
    expect(look?.caption).toBe('balayage')
    expect(look?.bookings).toBe(6)
    expect(result.totals.bookings).toBe(6)
  })
})

describe('loadCreatorLooksAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('assembles from index-backed queries with no per-look N+1', async () => {
    mocks.prisma.lookPost.aggregate.mockResolvedValue({
      _count: { _all: 4 },
      _sum: {
        viewCount: 900,
        likeCount: 80,
        commentCount: 12,
        saveCount: 30,
        shareCount: 5,
      },
    })
    mocks.prisma.lookPost.findMany.mockResolvedValue([
      {
        id: 'look-1',
        caption: 'sunset balayage',
        publishedAt: new Date('2026-07-02T00:00:00.000Z'),
        viewCount: 500,
        likeCount: 40,
        commentCount: 6,
        saveCount: 20,
        shareCount: 3,
        primaryMediaAsset: {
          thumbUrl: null,
          thumbBucket: 'b',
          thumbPath: 'p',
          url: null,
          storageBucket: 'b',
          storagePath: 'p2',
        },
      },
    ])
    mocks.prisma.proFollow.count.mockResolvedValue(42)
    mocks.prisma.proFollow.findMany.mockResolvedValue([
      { createdAt: new Date(NOW.getTime() - 3 * DAY) },
    ])
    mocks.prisma.booking.groupBy.mockResolvedValue([
      { sourceLookPostId: 'look-1', _count: { _all: 7 } },
    ])
    mocks.prisma.booking.count.mockResolvedValue(9)
    mocks.renderMediaUrls.mockResolvedValue({
      renderUrl: 'https://cdn/full.jpg',
      renderThumbUrl: 'https://cdn/thumb.jpg',
    })

    const result = await loadCreatorLooksAnalytics({
      professionalId: 'pro-1',
      now: NOW,
    })

    expect(result.publishedCount).toBe(4)
    expect(result.totals).toEqual({
      views: 900,
      likes: 80,
      comments: 12,
      saves: 30,
      shares: 5,
      bookings: 9,
    })
    expect(result.followers.total).toBe(42)
    expect(result.followers.new30d).toBe(1)
    expect(result.topLooks).toHaveLength(1)
    expect(result.topLooks[0]?.thumbUrl).toBe('https://cdn/thumb.jpg')
    expect(result.topLooks[0]?.bookings).toBe(7)

    // groupBy called once (single query, not per-look).
    expect(mocks.prisma.booking.groupBy).toHaveBeenCalledTimes(1)
    // aggregate _sum handles totals — findMany is only the bounded candidate set.
    expect(mocks.prisma.lookPost.findMany).toHaveBeenCalledTimes(1)
  })

  it('skips the booking groupBy when there are no published looks', async () => {
    mocks.prisma.lookPost.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: {
        viewCount: null,
        likeCount: null,
        commentCount: null,
        saveCount: null,
        shareCount: null,
      },
    })
    mocks.prisma.lookPost.findMany.mockResolvedValue([])
    mocks.prisma.proFollow.count.mockResolvedValue(0)
    mocks.prisma.proFollow.findMany.mockResolvedValue([])
    mocks.prisma.booking.count.mockResolvedValue(0)

    const result = await loadCreatorLooksAnalytics({
      professionalId: 'pro-1',
      now: NOW,
    })

    expect(result.publishedCount).toBe(0)
    expect(result.totals.views).toBe(0)
    expect(result.topLooks).toHaveLength(0)
    expect(mocks.prisma.booking.groupBy).not.toHaveBeenCalled()
  })
})
