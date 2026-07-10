import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaPhase } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  mediaAssetFindMany: vi.fn(),
  aftercareSummaryFindMany: vi.fn(),
  renderMediaUrls: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaAsset: { findMany: mocks.mediaAssetFindMany },
    aftercareSummary: { findMany: mocks.aftercareSummaryFindMany },
  },
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

import {
  loadBookingBeforeAfterThumbs,
  orderMediaByFeatured,
} from './bookingBeforeAfter'

function mediaRow(overrides: {
  id: string
  phase: MediaPhase
  createdAt: string
  bookingId?: string
}) {
  return {
    id: overrides.id,
    bookingId: overrides.bookingId ?? 'booking_1',
    phase: overrides.phase,
    createdAt: new Date(overrides.createdAt),
    storageBucket: 'media-private',
    storagePath: `p/${overrides.id}.jpg`,
    thumbBucket: null,
    thumbPath: null,
    url: null,
    thumbUrl: null,
  }
}

describe('orderMediaByFeatured', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('returns the list unchanged when no featured id', () => {
    expect(orderMediaByFeatured(items, null)).toBe(items)
    expect(orderMediaByFeatured(items, undefined)).toBe(items)
  })

  it('returns the list unchanged when the featured id is already first', () => {
    expect(orderMediaByFeatured(items, 'a')).toBe(items)
  })

  it('returns the list unchanged when the featured id is not present', () => {
    expect(orderMediaByFeatured(items, 'zzz')).toBe(items)
  })

  it('moves the featured id to the front, preserving the rest of the order', () => {
    expect(orderMediaByFeatured(items, 'c')).toEqual([
      { id: 'c' },
      { id: 'a' },
      { id: 'b' },
    ])
  })
})

describe('loadBookingBeforeAfterThumbs featured pair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Deterministic signer: each asset resolves to a URL derived from its path.
    mocks.renderMediaUrls.mockImplementation(
      (row: { storagePath?: string | null }) => ({
        renderUrl: `https://cdn.test/${row?.storagePath ?? 'x'}`,
        renderThumbUrl: null,
      }),
    )
    mocks.aftercareSummaryFindMany.mockResolvedValue([])
  })

  it('defaults to the earliest before/after when nothing is featured', async () => {
    mocks.mediaAssetFindMany.mockResolvedValueOnce([
      mediaRow({ id: 'b_early', phase: MediaPhase.BEFORE, createdAt: '2026-01-01T00:00:00Z' }),
      mediaRow({ id: 'b_late', phase: MediaPhase.BEFORE, createdAt: '2026-01-02T00:00:00Z' }),
      mediaRow({ id: 'a_early', phase: MediaPhase.AFTER, createdAt: '2026-01-01T01:00:00Z' }),
    ])

    const map = await loadBookingBeforeAfterThumbs(['booking_1'])
    const thumbs = map.get('booking_1')

    expect(thumbs?.beforeUrl).toBe('https://cdn.test/p/b_early.jpg')
    expect(thumbs?.afterUrl).toBe('https://cdn.test/p/a_early.jpg')
  })

  it('honors the pro-chosen featured pair over the earliest', async () => {
    mocks.mediaAssetFindMany.mockResolvedValueOnce([
      mediaRow({ id: 'b_early', phase: MediaPhase.BEFORE, createdAt: '2026-01-01T00:00:00Z' }),
      mediaRow({ id: 'b_late', phase: MediaPhase.BEFORE, createdAt: '2026-01-02T00:00:00Z' }),
      mediaRow({ id: 'a_early', phase: MediaPhase.AFTER, createdAt: '2026-01-01T01:00:00Z' }),
      mediaRow({ id: 'a_late', phase: MediaPhase.AFTER, createdAt: '2026-01-02T01:00:00Z' }),
    ])
    mocks.aftercareSummaryFindMany.mockResolvedValueOnce([
      {
        bookingId: 'booking_1',
        featuredBeforeAssetId: 'b_late',
        featuredAfterAssetId: 'a_late',
      },
    ])

    const map = await loadBookingBeforeAfterThumbs(['booking_1'])
    const thumbs = map.get('booking_1')

    expect(thumbs?.beforeUrl).toBe('https://cdn.test/p/b_late.jpg')
    expect(thumbs?.afterUrl).toBe('https://cdn.test/p/a_late.jpg')
  })

  it('falls back to the earliest when a featured id is stale/foreign', async () => {
    mocks.mediaAssetFindMany.mockResolvedValueOnce([
      mediaRow({ id: 'b_early', phase: MediaPhase.BEFORE, createdAt: '2026-01-01T00:00:00Z' }),
      mediaRow({ id: 'a_early', phase: MediaPhase.AFTER, createdAt: '2026-01-01T01:00:00Z' }),
    ])
    mocks.aftercareSummaryFindMany.mockResolvedValueOnce([
      {
        bookingId: 'booking_1',
        // References a deleted / other-booking asset not in the rows.
        featuredBeforeAssetId: 'ghost',
        featuredAfterAssetId: null,
      },
    ])

    const map = await loadBookingBeforeAfterThumbs(['booking_1'])
    const thumbs = map.get('booking_1')

    expect(thumbs?.beforeUrl).toBe('https://cdn.test/p/b_early.jpg')
    expect(thumbs?.afterUrl).toBe('https://cdn.test/p/a_early.jpg')
  })
})
