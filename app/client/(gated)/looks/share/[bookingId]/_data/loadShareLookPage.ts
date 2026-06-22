// app/client/(gated)/looks/share/[bookingId]/_data/loadShareLookPage.ts
import 'server-only'

import { BookingStatus, MediaPhase, MediaType, MediaVisibility, Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

export type ShareLookPrefillPhoto = {
  // The visit's existing pro-shot session photo for this phase (if any), shown as
  // a prefill the client can keep or replace. `reuseMediaAssetId` is what the
  // share-look API consumes to reuse it.
  reuseMediaAssetId: string
  previewUrl: string
}

export type ShareLookPageData = {
  bookingId: string
  serviceId: string
  serviceName: string
  professionalName: string
  professionalAvatarUrl: string | null
  visitDateLabel: string
  suggestedName: string
  prefill: {
    before: ShareLookPrefillPhoto | null
    after: ShareLookPrefillPhoto | null
  }
}

function formatVisitDate(value: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      month: 'short',
      day: 'numeric',
    }).format(value)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
    }).format(value)
  }
}

/**
 * Returns the most-recent pro-shot session photo for a phase, rendered via a
 * signed URL (private bucket). The client is the visit participant, so they're
 * authorized to preview their own before/after. Returns null when none exists.
 */
async function loadPrefillPhoto(
  bookingId: string,
  professionalId: string,
  phase: MediaPhase,
): Promise<ShareLookPrefillPhoto | null> {
  const row = await prisma.mediaAsset.findFirst({
    where: {
      bookingId,
      professionalId,
      phase,
      mediaType: MediaType.IMAGE,
      visibility: MediaVisibility.PRO_CLIENT,
      uploadedByRole: Role.PRO,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      url: true,
      thumbUrl: true,
    },
  })

  if (!row) return null

  const { renderUrl, renderThumbUrl } = await renderMediaUrls(row)
  const previewUrl = renderThumbUrl ?? renderUrl
  if (!previewUrl) return null

  return { reuseMediaAssetId: row.id, previewUrl }
}

/**
 * Loads everything the Share-your-look sheet needs for a completed visit, or null
 * when the visit is missing, not the caller's, or not yet complete (the page
 * turns that into a redirect / not-found).
 */
export async function loadShareLookPage(
  bookingId: string,
): Promise<ShareLookPageData | null> {
  const user = await getCurrentUser().catch(() => null)
  const clientId = user?.clientProfile?.id
  if (!user || user.role !== 'CLIENT' || !clientId) return null

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      serviceId: true,
      status: true,
      scheduledFor: true,
      locationTimeZone: true,
      service: { select: { name: true } },
      professional: {
        select: {
          businessName: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
    },
  })

  if (
    !booking ||
    booking.clientId !== clientId ||
    booking.status !== BookingStatus.COMPLETED ||
    !booking.serviceId
  ) {
    return null
  }

  const [before, after] = await Promise.all([
    loadPrefillPhoto(booking.id, booking.professionalId, MediaPhase.BEFORE),
    loadPrefillPhoto(booking.id, booking.professionalId, MediaPhase.AFTER),
  ])

  const serviceName = booking.service?.name ?? 'Your booking'

  return {
    bookingId: booking.id,
    serviceId: booking.serviceId,
    serviceName,
    professionalName: formatProfessionalPublicDisplayName(
      booking.professional,
    ),
    professionalAvatarUrl: booking.professional?.avatarUrl ?? null,
    visitDateLabel: formatVisitDate(booking.scheduledFor, booking.locationTimeZone),
    suggestedName: serviceName,
    prefill: { before, after },
  }
}
