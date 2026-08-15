// app/professionals/[id]/_data/loadProPublicProfile.test.ts
//
// §19c — the public profile grid reads the pro's own `LookPost`s (the unified
// public-content atom), not `MediaAsset.isFeaturedInPortfolio`. These cover the
// query gate (owner-relation read, pro-authored + published + APPROVED + public,
// newest-first) and that each tile still maps from the look's `primaryMediaAsset`
// (stable DTO).
//
// Screen 6 added three things this file also locks: per-tile engagement counts,
// the Signature block, and the rule that the Signature leaves the grid.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaType, MediaVisibility, BookingStatus } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const professionalProfile = { findUnique: vi.fn() }
  const lookPost = { findFirst: vi.fn() }
  const booking = { groupBy: vi.fn() }
  return {
    professionalProfile,
    lookPost,
    booking,
    prisma: { professionalProfile, lookPost, booking },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { loadProProfileWork } from './loadProPublicProfile'
import { proOwnPublicLooksWhere } from '@/lib/looks/selects'
import { PUBLIC_PROFILE_LIMITS } from '@/lib/profiles/publicProfileSelects'

function makeLookRow(
  overrides: Record<string, unknown> = {},
  mediaOverrides: Record<string, unknown> = {},
) {
  return {
    id: 'look_1',
    publishedAt: new Date('2026-01-02T00:00:00.000Z'),
    likeCount: 214,
    commentCount: 18,
    // A pre-rendered public asset: url + thumbUrl present so the mapper does not
    // need to sign anything (renderMediaUrls is never called).
    primaryMediaAsset: {
      id: 'media_1',
      professionalId: 'pro_1',
      caption: 'Balayage',
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PUBLIC,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      storageBucket: 'media-public',
      storagePath: 'p/1.jpg',
      thumbBucket: 'media-public',
      thumbPath: 'p/1-thumb.jpg',
      url: 'https://cdn.example/1.jpg',
      thumbUrl: 'https://cdn.example/1-thumb.jpg',
      beforeAsset: null,
      services: [{ serviceId: 'svc_1', service: { name: 'Balayage' } }],
      ...mediaOverrides,
    },
    ...overrides,
  }
}

function mockProfileLooks(lookRows: unknown[]) {
  mocks.professionalProfile.findUnique.mockResolvedValue({ lookPosts: lookRows })
}

async function loadGrid(signatureMediaAssetId: string | null = null) {
  return loadProProfileWork({
    professionalId: 'pro_1',
    signatureMediaAssetId,
    offerings: [],
  })
}

describe('loadProProfileWork (§19c — grid reads pro LookPosts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lookPost.findFirst.mockResolvedValue(null)
    mocks.booking.groupBy.mockResolvedValue([])
  })

  it('reads the pro-authored, published, APPROVED, public looks newest-first via the owner relation', async () => {
    mockProfileLooks([])

    await loadGrid()

    // Owner-relation read (professionalProfile.lookPosts), NOT a top-level
    // lookPost.findMany discovery read — scoped to this one pro by construction.
    expect(mocks.professionalProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pro_1' },
        select: expect.objectContaining({
          lookPosts: expect.objectContaining({
            // The moderation gate is the point: nothing renders public pre-APPROVED,
            // and client-authored looks (clientAuthorId set) stay on /u/[handle].
            // Shared with the "Looks" stat count so the grid and the tile can't
            // disagree — lib/looks/selects.test.ts locks the clause's contents.
            where: proOwnPublicLooksWhere,
            orderBy: { publishedAt: 'desc' },
            take: PUBLIC_PROFILE_LIMITS.portfolioTiles,
          }),
        }),
      }),
    )
  })

  it('maps each look to a tile from its primaryMediaAsset (tile id = media id)', async () => {
    mockProfileLooks([makeLookRow()])

    const { portfolioTiles } = await loadGrid()

    expect(portfolioTiles).toHaveLength(1)
    // Tile id stays the MediaAsset id (→ native/render parity); §19f additionally
    // threads the backing look id so the grid links to /looks/[lookId].
    expect(portfolioTiles[0]).toMatchObject({
      id: 'media_1',
      lookId: 'look_1',
      src: 'https://cdn.example/1-thumb.jpg',
      caption: 'Balayage',
      serviceIds: ['svc_1'],
      isVideo: false,
      before: null,
    })
  })

  it('returns [] when the profile is missing', async () => {
    mocks.professionalProfile.findUnique.mockResolvedValue(null)

    expect((await loadGrid()).portfolioTiles).toEqual([])
  })

  it('drops a look whose asset has no renderable source', async () => {
    mockProfileLooks([
      makeLookRow(
        {},
        {
          url: null,
          thumbUrl: null,
          storageBucket: null,
          storagePath: null,
        },
      ),
    ])

    expect((await loadGrid()).portfolioTiles).toEqual([])
  })
})

describe('loadProProfileWork — tile engagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lookPost.findFirst.mockResolvedValue(null)
    mocks.booking.groupBy.mockResolvedValue([])
  })

  it('carries the look’s like/comment counters onto the tile', async () => {
    mockProfileLooks([makeLookRow()])

    const { portfolioTiles } = await loadGrid()

    expect(portfolioTiles[0]?.engagement).toMatchObject({
      likeCount: 214,
      commentCount: 18,
    })
  })

  it('counts "N recreated this" in ONE grouped read for the whole grid, excluding cancellations', async () => {
    mockProfileLooks([
      makeLookRow({ id: 'look_1' }),
      makeLookRow({ id: 'look_2' }, { id: 'media_2', storagePath: 'p/2.jpg' }),
    ])
    mocks.booking.groupBy.mockResolvedValue([
      { sourceLookPostId: 'look_2', _count: { _all: 12 } },
    ])

    const { portfolioTiles } = await loadGrid()

    expect(mocks.booking.groupBy).toHaveBeenCalledTimes(1)
    expect(mocks.booking.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['sourceLookPostId'],
        where: expect.objectContaining({
          sourceLookPostId: { in: ['look_1', 'look_2'] },
          status: { not: BookingStatus.CANCELLED },
        }),
      }),
    )

    // A look with no attributed bookings reads ZERO, not undefined — the grid
    // renders a zero as nothing at all, never as a literal "0".
    expect(portfolioTiles[0]?.engagement.recreatedCount).toBe(0)
    expect(portfolioTiles[1]?.engagement.recreatedCount).toBe(12)
  })

  it('never groups when there are no looks to count', async () => {
    mockProfileLooks([])

    await loadGrid()

    expect(mocks.booking.groupBy).not.toHaveBeenCalled()
  })
})

describe('loadProProfileWork — the Signature post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lookPost.findFirst.mockResolvedValue(null)
    mocks.booking.groupBy.mockResolvedValue([])
  })

  it('is not read at all when the pro has not chosen one', async () => {
    mockProfileLooks([makeLookRow()])

    const { signature } = await loadGrid(null)

    expect(signature).toBeNull()
    expect(mocks.lookPost.findFirst).not.toHaveBeenCalled()
  })

  it('reads the chosen asset under the SAME publicity clause, scoped to this pro', async () => {
    mockProfileLooks([])
    await loadGrid('media_9')

    expect(mocks.lookPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          professionalId: 'pro_1',
          primaryMediaAssetId: 'media_9',
          ...proOwnPublicLooksWhere,
        }),
      }),
    )
  })

  it('renders nothing when the chosen look is no longer publicly visible', async () => {
    mockProfileLooks([makeLookRow()])
    // The gated read finds no row — an unpublished/retracted/foreign look.
    mocks.lookPost.findFirst.mockResolvedValue(null)

    const { signature, portfolioTiles } = await loadGrid('media_9')

    expect(signature).toBeNull()
    // ...and the grid is untouched.
    expect(portfolioTiles).toHaveLength(1)
  })

  it('leaves the grid once promoted, so it never renders twice', async () => {
    mockProfileLooks([
      makeLookRow({ id: 'look_1' }),
      makeLookRow({ id: 'look_2' }, { id: 'media_2', storagePath: 'p/2.jpg' }),
    ])
    mocks.lookPost.findFirst.mockResolvedValue({
      ...makeLookRow({ id: 'look_1' }),
      serviceId: 'svc_1',
    })

    const { signature, portfolioTiles } = await loadGrid('media_1')

    expect(signature?.tile.lookId).toBe('look_1')
    expect(portfolioTiles.map((tile) => tile.lookId)).toEqual(['look_2'])
  })

  it('books the look it shows, and shares the grid’s single recreate read', async () => {
    mockProfileLooks([])
    mocks.lookPost.findFirst.mockResolvedValue({
      ...makeLookRow({ id: 'look_7' }),
      serviceId: 'svc_1',
    })
    mocks.booking.groupBy.mockResolvedValue([
      { sourceLookPostId: 'look_7', _count: { _all: 5 } },
    ])

    const { signature } = await loadGrid('media_1')

    expect(mocks.booking.groupBy).toHaveBeenCalledTimes(1)
    // The `?book=1` contract screen 2 already uses: the appointment inherits the
    // picture that prompted it.
    expect(signature?.bookHref).toBe('/looks/look_7?book=1')
    expect(signature?.tile.engagement.recreatedCount).toBe(5)
  })

  it('prints no price when the pro has no active offering for the look’s service', async () => {
    mockProfileLooks([])
    mocks.lookPost.findFirst.mockResolvedValue({
      ...makeLookRow({ id: 'look_7' }),
      serviceId: 'svc_unlisted',
    })

    const { signature } = await loadGrid('media_1')

    expect(signature?.priceLine).toBeNull()
  })
})
