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

function makePortfolioRow(
  overrides?: Partial<{
    mediaType: MediaType
    beforeAsset: typeof beforeImage | null
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
    services: [],
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
})
