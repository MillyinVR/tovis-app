// app/professionals/[id]/_data/loadProPublicProfile.test.ts
//
// §19c — the public profile grid reads the pro's own `LookPost`s (the unified
// public-content atom), not `MediaAsset.isFeaturedInPortfolio`. These cover the
// query gate (owner-relation read, pro-authored + published + APPROVED + public,
// newest-first) and that each tile still maps from the look's `primaryMediaAsset`
// (stable DTO).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const professionalProfile = { findUnique: vi.fn() }
  return { professionalProfile, prisma: { professionalProfile } }
})

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

import { loadPortfolioTiles } from './loadProPublicProfile'
import { PUBLIC_PROFILE_LIMITS } from '@/lib/profiles/publicProfileSelects'

function makeLookRow(mediaOverrides: Record<string, unknown> = {}) {
  return {
    id: 'look_1',
    publishedAt: new Date('2026-01-02T00:00:00.000Z'),
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
      services: [{ serviceId: 'svc_1' }],
      ...mediaOverrides,
    },
  }
}

function mockProfileLooks(lookRows: unknown[]) {
  mocks.professionalProfile.findUnique.mockResolvedValue({ lookPosts: lookRows })
}

describe('loadPortfolioTiles (§19c — grid reads pro LookPosts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the pro-authored, published, APPROVED, public looks newest-first via the owner relation', async () => {
    mockProfileLooks([])

    await loadPortfolioTiles('pro_1')

    // Owner-relation read (professionalProfile.lookPosts), NOT a top-level
    // lookPost.findMany discovery read — scoped to this one pro by construction.
    expect(mocks.professionalProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pro_1' },
        select: expect.objectContaining({
          lookPosts: expect.objectContaining({
            // The moderation gate is the point: nothing renders public pre-APPROVED,
            // and client-authored looks (clientAuthorId set) stay on /u/[handle].
            where: {
              clientAuthorId: null,
              status: LookPostStatus.PUBLISHED,
              moderationStatus: ModerationStatus.APPROVED,
              visibility: LookPostVisibility.PUBLIC,
              removedAt: null,
            },
            orderBy: { publishedAt: 'desc' },
            take: PUBLIC_PROFILE_LIMITS.portfolioTiles,
          }),
        }),
      }),
    )
  })

  it('maps each look to a tile from its primaryMediaAsset (tile id = media id)', async () => {
    mockProfileLooks([makeLookRow()])

    const tiles = await loadPortfolioTiles('pro_1')

    expect(tiles).toHaveLength(1)
    // Tile id stays the MediaAsset id (→ native/render parity); §19f additionally
    // threads the backing look id so the grid links to /looks/[lookId].
    expect(tiles[0]).toMatchObject({
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

    expect(await loadPortfolioTiles('pro_1')).toEqual([])
  })

  it('drops a look whose asset has no renderable source', async () => {
    mockProfileLooks([
      makeLookRow({
        url: null,
        thumbUrl: null,
        storageBucket: null,
        storagePath: null,
      }),
    ])

    expect(await loadPortfolioTiles('pro_1')).toEqual([])
  })
})
