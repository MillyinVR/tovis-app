import { MediaType, MediaVisibility } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

// Keep the mapper hermetic: echo stored pointers back as render URLs so the test
// exercises the pairing logic, not storage signing.
vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: vi.fn(
    async (input: { url?: string | null; thumbUrl?: string | null }) => ({
      renderUrl: input.url ?? null,
      renderThumbUrl: input.thumbUrl ?? null,
    }),
  ),
}))

import {
  mapPairedBeforeToDto,
  mapPublicPortfolioTileToDto,
  mapPublicProfileStatsToDto,
  mapPublicReviewMediaAssetToDto,
} from './publicProfileMappers'

const beforeImage = {
  id: 'before_1',
  mediaType: MediaType.IMAGE,
  storageBucket: 'media-public',
  storagePath: 'p/before_1.jpg',
  thumbBucket: null,
  thumbPath: null,
  url: 'https://cdn.example.com/before_1.jpg',
  thumbUrl: 'https://cdn.example.com/before_1_thumb.jpg',
}

type ServiceTagRow = { serviceId: string; service: { name: string } }

function makePortfolioRow(
  overrides?: Partial<{
    mediaType: MediaType
    beforeAsset: typeof beforeImage | null
    services: ServiceTagRow[]
  }>,
) {
  return {
    id: 'after_1',
    professionalId: 'pro_1',
    caption: null,
    mediaType: MediaType.IMAGE,
    visibility: MediaVisibility.PUBLIC,
    isEligibleForLooks: false,
    isFeaturedInPortfolio: true,
    storageBucket: 'media-public',
    storagePath: 'p/after_1.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: 'https://cdn.example.com/after_1.jpg',
    thumbUrl: 'https://cdn.example.com/after_1_thumb.jpg',
    beforeAsset: null as typeof beforeImage | null,
    services: [] as ServiceTagRow[],
    ...(overrides ?? {}),
  }
}

describe('mapPairedBeforeToDto', () => {
  it('renders an image before to thumb + full URLs', async () => {
    await expect(mapPairedBeforeToDto(beforeImage)).resolves.toEqual({
      id: 'before_1',
      thumbUrl: 'https://cdn.example.com/before_1_thumb.jpg',
      fullUrl: 'https://cdn.example.com/before_1.jpg',
    })
  })

  it('returns null for no pairing', async () => {
    await expect(mapPairedBeforeToDto(null)).resolves.toBeNull()
  })

  it('returns null when the counterpart is a video', async () => {
    await expect(
      mapPairedBeforeToDto({ ...beforeImage, mediaType: MediaType.VIDEO }),
    ).resolves.toBeNull()
  })
})

describe('mapPublicPortfolioTileToDto before/after pairing', () => {
  it('exposes the paired before on an image tile', async () => {
    const tile = await mapPublicPortfolioTileToDto(
      makePortfolioRow({ beforeAsset: beforeImage }),
    )
    expect(tile?.before).toEqual({
      id: 'before_1',
      thumbUrl: 'https://cdn.example.com/before_1_thumb.jpg',
      fullUrl: 'https://cdn.example.com/before_1.jpg',
    })
  })

  it('has a null before when nothing is paired', async () => {
    const tile = await mapPublicPortfolioTileToDto(makePortfolioRow())
    expect(tile?.before).toBeNull()
  })

  it('drops the pairing when the after tile is a video', async () => {
    const tile = await mapPublicPortfolioTileToDto(
      makePortfolioRow({ mediaType: MediaType.VIDEO, beforeAsset: beforeImage }),
    )
    expect(tile?.before).toBeNull()
  })

  it('threads the backing look id (§19f) — null when omitted', async () => {
    expect((await mapPublicPortfolioTileToDto(makePortfolioRow()))?.lookId).toBeNull()
    expect(
      (await mapPublicPortfolioTileToDto(makePortfolioRow(), 'look_9'))?.lookId,
    ).toBe('look_9')
  })
})

describe('mapPublicPortfolioTileToDto service tags', () => {
  it('carries display names alongside the ids, in tag order', async () => {
    const tile = await mapPublicPortfolioTileToDto(
      makePortfolioRow({
        services: [
          { serviceId: 'svc_1', service: { name: 'Balayage' } },
          { serviceId: 'svc_2', service: { name: 'Gloss' } },
        ],
      }),
    )

    expect(tile?.serviceIds).toEqual(['svc_1', 'svc_2'])
    expect(tile?.serviceNames).toEqual(['Balayage', 'Gloss'])
  })

  it('is an empty list when the media carries no tags', async () => {
    const tile = await mapPublicPortfolioTileToDto(makePortfolioRow())
    expect(tile?.serviceNames).toEqual([])
  })

  it('trims, drops blank names and de-duplicates', async () => {
    const tile = await mapPublicPortfolioTileToDto(
      makePortfolioRow({
        services: [
          { serviceId: 'svc_1', service: { name: '  Balayage  ' } },
          { serviceId: 'svc_2', service: { name: '   ' } },
          { serviceId: 'svc_3', service: { name: 'Balayage' } },
        ],
      }),
    )

    expect(tile?.serviceNames).toEqual(['Balayage'])
  })
})

function makeReviewMediaRow(
  overrides?: Partial<{
    mediaType: MediaType
    beforeAsset: typeof beforeImage | null
  }>,
) {
  return {
    id: 'review_after_1',
    mediaType: MediaType.IMAGE,
    isFeaturedInPortfolio: false,
    storageBucket: 'media-public',
    storagePath: 'p/review_after_1.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: 'https://cdn.example.com/review_after_1.jpg',
    thumbUrl: 'https://cdn.example.com/review_after_1_thumb.jpg',
    beforeAsset: null as typeof beforeImage | null,
    ...(overrides ?? {}),
  }
}

describe('mapPublicReviewMediaAssetToDto before/after pairing', () => {
  it('exposes the paired before on a review after photo', async () => {
    const media = await mapPublicReviewMediaAssetToDto(
      makeReviewMediaRow({ beforeAsset: beforeImage }),
    )
    expect(media?.before).toEqual({
      id: 'before_1',
      thumbUrl: 'https://cdn.example.com/before_1_thumb.jpg',
      fullUrl: 'https://cdn.example.com/before_1.jpg',
    })
  })

  it('has a null before when the review photo is unpaired', async () => {
    const media = await mapPublicReviewMediaAssetToDto(makeReviewMediaRow())
    expect(media?.before).toBeNull()
  })

  it('drops the pairing when the review photo is a video', async () => {
    const media = await mapPublicReviewMediaAssetToDto(
      makeReviewMediaRow({ mediaType: MediaType.VIDEO, beforeAsset: beforeImage }),
    )
    expect(media?.before).toBeNull()
  })
})

describe('mapPublicProfileStatsToDto looks + followers', () => {
  const baseArgs = {
    offerings: [],
    completedBookingCount: 0,
    favoritesCount: 0,
    reviewCount: 0,
    averageRating: null,
    followerCount: 0,
    publishedLooksCount: 0,
  }

  it('formats looks + followers compactly, like the sibling labels', () => {
    const stats = mapPublicProfileStatsToDto({
      ...baseArgs,
      followerCount: 12_480,
      publishedLooksCount: 1_200,
    })

    expect(stats.looksLabel).toBe('1.2K')
    expect(stats.followersLabel).toBe('12.5K')
  })

  it('keeps followerCount raw for the Follow button optimistic nudge', () => {
    const stats = mapPublicProfileStatsToDto({
      ...baseArgs,
      followerCount: 12_480,
    })

    // The label is for the static stats tile; the button needs the number.
    expect(stats.followerCount).toBe(12_480)
    expect(stats.followersLabel).toBe('12.5K')
  })

  it('renders a zero look count as "0" rather than hiding the tile', () => {
    const stats = mapPublicProfileStatsToDto(baseArgs)

    expect(stats.looksLabel).toBe('0')
    expect(stats.followersLabel).toBe('0')
  })

  it('floors a negative follower count to zero in both projections', () => {
    const stats = mapPublicProfileStatsToDto({
      ...baseArgs,
      followerCount: -3,
    })

    expect(stats.followerCount).toBe(0)
    expect(stats.followersLabel).toBe('0')
  })
})
