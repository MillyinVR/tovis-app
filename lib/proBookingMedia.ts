// lib/proBookingMedia.ts
//
// Single listing path for pro booking session media. The HTTP route
// (app/api/v1/pro/bookings/[id]/media) and the session server pages
// (before-photos / after-photos) both go through listProBookingMedia, so the
// booking ownership check and signed-URL rendering never fork into separate
// implementations.

import { MediaPhase } from '@prisma/client'
import type { MediaType, MediaVisibility } from '@prisma/client'

import { renderMediaUrls } from '@/lib/media/renderUrls'
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
  // Booking.mediaUseConsentAt — when set, the client granted media-use consent
  // unlocking public sharing for the whole session's media (see
  // lib/media/publicShareGuard.ts). Carried raw (Date | null) so the route can
  // shape it to the wire boolean (`clientUseConsent`).
  mediaUseConsentAt: Date | null
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

/**
 * Display order for one visit's photos: BEFORE, then AFTER, then anything else.
 *
 * The web chart's photo timeline and the native chart's per-visit photos read
 * the SAME rows and must tell the same story in the same order — a device that
 * led with the AFTER shot would be showing a different visit than the web.
 * Keyed off Prisma's enum so a new phase can't be ordered by a stale copy.
 */
const MEDIA_PHASE_ORDER: Record<string, number> = {
  [MediaPhase.BEFORE]: 0,
  [MediaPhase.AFTER]: 1,
  [MediaPhase.OTHER]: 2,
}

/** Sort comparator over `MEDIA_PHASE_ORDER`; unknown phases sort last. */
export function comparePhotoPhase(a: string, b: string): number {
  return (MEDIA_PHASE_ORDER[a] ?? 9) - (MEDIA_PHASE_ORDER[b] ?? 9)
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
      mediaUseConsentAt: true,
    },
  })

  if (!booking) {
    return { ok: false, status: 404, error: 'Booking not found.' }
  }

  if (booking.professionalId !== professionalId) {
    // Uniform 404 on a foreign booking — indistinguishable from a missing one
    // so the API never reveals it exists (matches requireProBooking / the
    // booking write boundary's no-leak contract).
    return { ok: false, status: 404, error: 'Booking not found.' }
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

  return { ok: true, items, mediaUseConsentAt: booking.mediaUseConsentAt }
}
