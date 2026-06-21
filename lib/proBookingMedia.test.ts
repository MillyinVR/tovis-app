// lib/proBookingMedia.test.ts
import { describe, expect, it, vi } from 'vitest'
import { MediaPhase, MediaType, MediaVisibility } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prisma: {
    booking: {
      findUnique: vi.fn(),
    },
    mediaAsset: {
      findMany: vi.fn(),
    },
  },
  renderMediaUrls: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/media/renderUrls', () => ({
  renderMediaUrls: mocks.renderMediaUrls,
}))

import { listProBookingMedia, parseMediaPhase } from './proBookingMedia'

const bookingRow = {
  id: 'booking_1',
  professionalId: 'pro_1',
}

const mediaRow = {
  id: 'media_1',
  mediaType: MediaType.IMAGE,
  visibility: MediaVisibility.PRO_CLIENT,
  phase: MediaPhase.BEFORE,
  caption: 'Before photo',
  createdAt: new Date('2026-04-12T18:00:00.000Z'),
  reviewId: null,
  isEligibleForLooks: false,
  isFeaturedInPortfolio: false,
  storageBucket: 'media-private',
  storagePath: 'bookings/booking_1/before/main.jpg',
  thumbBucket: 'media-private',
  thumbPath: 'bookings/booking_1/before/thumb.jpg',
  url: null,
  thumbUrl: null,
}

const renderedUrls = {
  renderUrl: 'https://signed.example/main.jpg',
  renderThumbUrl: 'https://signed.example/thumb.jpg',
}

describe('parseMediaPhase', () => {
  it('normalizes casing and whitespace for known phases', () => {
    expect(parseMediaPhase(' before ')).toBe(MediaPhase.BEFORE)
    expect(parseMediaPhase('AFTER')).toBe(MediaPhase.AFTER)
    expect(parseMediaPhase('other')).toBe(MediaPhase.OTHER)
  })

  it('returns null for unknown or non-string values', () => {
    expect(parseMediaPhase('BANANA')).toBeNull()
    expect(parseMediaPhase('')).toBeNull()
    expect(parseMediaPhase(null)).toBeNull()
    expect(parseMediaPhase(42)).toBeNull()
  })
})

describe('listProBookingMedia', () => {
  it('returns 404 when the booking does not exist', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(null)

    const outcome = await listProBookingMedia({
      bookingId: 'booking_missing',
      professionalId: 'pro_1',
      phase: MediaPhase.BEFORE,
    })

    expect(outcome).toEqual({
      ok: false,
      status: 404,
      error: 'Booking not found.',
    })

    expect(mocks.prisma.mediaAsset.findMany).not.toHaveBeenCalled()
  })

  it('returns 404 when the booking belongs to another professional (no existence leak)', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(bookingRow)

    const outcome = await listProBookingMedia({
      bookingId: 'booking_1',
      professionalId: 'other_pro',
      phase: MediaPhase.BEFORE,
    })

    expect(outcome).toEqual({
      ok: false,
      status: 404,
      error: 'Booking not found.',
    })

    expect(mocks.prisma.mediaAsset.findMany).not.toHaveBeenCalled()
    expect(mocks.renderMediaUrls).not.toHaveBeenCalled()
  })

  it('lists phase-filtered media with rendered urls for the owning pro', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(bookingRow)
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([mediaRow])
    mocks.renderMediaUrls.mockResolvedValue(renderedUrls)

    const outcome = await listProBookingMedia({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      phase: MediaPhase.BEFORE,
    })

    expect(mocks.prisma.booking.findUnique).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: { id: true, professionalId: true },
    })

    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking_1',
        phase: MediaPhase.BEFORE,
      },
      select: expect.any(Object),
      orderBy: { createdAt: 'desc' },
    })

    expect(mocks.renderMediaUrls).toHaveBeenCalledWith({
      storageBucket: mediaRow.storageBucket,
      storagePath: mediaRow.storagePath,
      thumbBucket: mediaRow.thumbBucket,
      thumbPath: mediaRow.thumbPath,
      url: null,
      thumbUrl: null,
    })

    expect(outcome).toEqual({
      ok: true,
      items: [
        {
          ...mediaRow,
          renderUrl: renderedUrls.renderUrl,
          renderThumbUrl: renderedUrls.renderThumbUrl,
          url: renderedUrls.renderUrl,
          thumbUrl: renderedUrls.renderThumbUrl,
        },
      ],
    })
  })

  it('omits the phase filter when no phase is provided', async () => {
    mocks.prisma.booking.findUnique.mockResolvedValue(bookingRow)
    mocks.prisma.mediaAsset.findMany.mockResolvedValue([])

    const outcome = await listProBookingMedia({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
    })

    expect(mocks.prisma.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: 'booking_1' },
      }),
    )

    expect(outcome).toEqual({ ok: true, items: [] })
  })
})
