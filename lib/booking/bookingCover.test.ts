// lib/booking/bookingCover.test.ts
//
// Which URL the booking sheet's cover is handed. The visibility gate is the
// same `isPubliclyViewableMediaAsset` every public surface uses and is tested
// with it; what is pinned here is the PREFERENCE — the downscaled render over
// the stored original, with the original carried as the fallback — because
// this used to be the other way round and nothing noticed: a 4.5 MB phone
// capture painted into a 264px-tall well on every booking sheet.
import { MediaVisibility } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  renderMediaUrls: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { mediaAsset: { findFirst: mocks.findFirst } },
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

import { loadBookingCover } from './bookingCover'

const ORIGINAL = 'https://cdn.example.test/storage/v1/object/public/media-public/p/look.jpg'
const RENDER =
  'https://cdn.example.test/storage/v1/render/image/public/media-public/p/look.jpg?width=1080&resize=contain&quality=70'

function publicRow() {
  return {
    visibility: MediaVisibility.PUBLIC,
    isFeaturedInPortfolio: false,
    isEligibleForLooks: true,
    reviewId: null,
    storageBucket: 'media-public',
    storagePath: 'p/look.jpg',
    thumbBucket: null,
    thumbPath: null,
    url: null,
    thumbUrl: null,
    lookPostPrimaryFor: [{ caption: 'Lived-in blonde' }],
  }
}

beforeEach(() => {
  mocks.findFirst.mockReset()
  mocks.renderMediaUrls.mockReset()
})

describe('loadBookingCover', () => {
  it('asks for the feed render and hands the sheet the render, with the original as fallback', async () => {
    mocks.findFirst.mockResolvedValue(publicRow())
    mocks.renderMediaUrls.mockResolvedValue({
      renderUrl: ORIGINAL,
      renderThumbUrl: RENDER,
    })

    const cover = await loadBookingCover('media_1')

    // `feed`, not `tile`: one URL serves the 780px-wide cover AND the 38px strip.
    expect(mocks.renderMediaUrls).toHaveBeenCalledWith(expect.anything(), {
      variant: 'feed',
    })
    expect(cover).toEqual({
      imageUrl: RENDER,
      fallbackImageUrl: ORIGINAL,
      lookName: 'Lived-in blonde',
    })
  })

  it('serves the original with NO fallback when nothing can be derived — never a retry of the same URL', async () => {
    mocks.findFirst.mockResolvedValue(publicRow())
    mocks.renderMediaUrls.mockResolvedValue({
      renderUrl: ORIGINAL,
      renderThumbUrl: null,
    })

    const cover = await loadBookingCover('media_1')

    expect(cover?.imageUrl).toBe(ORIGINAL)
    expect(cover?.fallbackImageUrl).toBeNull()
  })

  it('is null for media that is not publicly viewable — a retracted look gets no cover', async () => {
    mocks.findFirst.mockResolvedValue({
      ...publicRow(),
      isEligibleForLooks: false,
      isFeaturedInPortfolio: false,
      visibility: MediaVisibility.PRO_CLIENT,
    })

    expect(await loadBookingCover('media_1')).toBeNull()
    expect(mocks.renderMediaUrls).not.toHaveBeenCalled()
  })

  it('is null with no media id, without touching the database', async () => {
    expect(await loadBookingCover('  ')).toBeNull()
    expect(await loadBookingCover(null)).toBeNull()
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })
})
