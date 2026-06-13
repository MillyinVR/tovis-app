// lib/proBookingMedia.ts
//
// Single listing path for pro booking session media. The HTTP route
// (app/api/pro/bookings/[id]/media) and the session server pages
// (before-photos / after-photos) both go through listProBookingMedia, so the
// booking ownership check and signed-URL rendering never fork into separate
// implementations.

import { MediaPhase } from '@prisma/client'
import type { MediaType, MediaVisibility } from '@prisma/client'

import { renderMediaUrls } from './media/renderUrls'
import { prisma } from './prisma'

export type ProBookingMediaItem = {
  id: string
  mediaType: MediaType
  visibility: MediaVisibility
  phase: MediaPhase
  caption: string | null
  createdAt: Date
  reviewId: string | null
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
  renderUrl: string | null
  renderThumbUrl: string | null
}

export type ListProBookingMediaInput = {
  bookingId: string
  professionalId: string
  phase?: MediaPhase | null
}

export type ListProBookingMediaSuccess = {
  ok: true
  items: ProBookingMediaItem[]
}

export type ListProBookingMediaFailure = {
  ok: false
  status: number
  error: string
}

export type ListProBookingMediaOutcome =
  | ListProBookingMediaSuccess
  | ListProBookingMediaFailure

export function parseMediaPhase(value: unknown): MediaPhase | null {
  const normalized =
    typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (normalized === MediaPhase.BEFORE) return MediaPhase.BEFORE
  if (normalized === MediaPhase.AFTER) return MediaPhase.AFTER
  if (normalized === MediaPhase.OTHER) return MediaPhase.OTHER

  return null
}

export async function listProBookingMedia(
  input: ListProBookingMediaInput,
): Promise<ListProBookingMediaOutcome> {
  const { bookingId, professionalId, phase } = input

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
    },
  })

  if (!booking) {
    return { ok: false, status: 404, error: 'Booking not found.' }
  }

  if (booking.professionalId !== professionalId) {
    return { ok: false, status: 403, error: 'Forbidden.' }
  }

  const where: { bookingId: string; phase?: MediaPhase } = { bookingId }

  if (phase) {
    where.phase = phase
  }

  const rows = await prisma.mediaAsset.findMany({
    where,
    select: {
      id: true,
      mediaType: true,
      visibility: true,
      phase: true,
      caption: true,
      createdAt: true,
      reviewId: true,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      url: true,
      thumbUrl: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const items = await Promise.all(
    rows.map(async (media): Promise<ProBookingMediaItem> => {
      const { renderUrl, renderThumbUrl } = await renderMediaUrls({
        storageBucket: media.storageBucket,
        storagePath: media.storagePath,
        thumbBucket: media.thumbBucket,
        thumbPath: media.thumbPath,
        url: media.url,
        thumbUrl: media.thumbUrl,
      })

      return {
        ...media,
        renderUrl,
        renderThumbUrl,
        url: renderUrl,
        thumbUrl: renderThumbUrl,
      }
    }),
  )

  return { ok: true, items }
}
