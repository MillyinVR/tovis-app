// lib/booking/bookingCover.ts
//
// The image and name of the look a booking is being made FROM — the cover the
// booking sheet opens with ("Booking this look"), and the thumbnail the add-ons
// step carries over so the second screen still names what you are booking.
//
// Resolved from the `mediaId` the booking flow already threads through every
// surface, so nothing new has to be plumbed from the look feed.
import { MediaVisibility, type Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { lookNameFromCaption } from '@/lib/looks/publication/clientLookService'

export type BookingCover = {
  imageUrl: string | null
  /** The look's display name, or null when this media is not a published look. */
  lookName: string | null
}

/**
 * `null` when there is no media (a booking started from a pro's profile rather
 * than from a look) — the sheet then renders its cover-less header rather than
 * an empty photo well.
 *
 * ⚠️ PUBLIC media only. A booking can be started from a look whose media has
 * since been made private, and a signed URL for private media has no business
 * being minted into a booking sheet — the cover is decoration, not an entitlement.
 */
export async function loadBookingCover(
  mediaId: string | null | undefined,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<BookingCover | null> {
  const id = typeof mediaId === 'string' ? mediaId.trim() : ''
  if (!id) return null

  const media = await db.mediaAsset.findFirst({
    where: { id, visibility: MediaVisibility.PUBLIC },
    select: {
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,
      url: true,
      thumbUrl: true,
      // The relation is a list (a media asset is the primary for at most one
      // look in practice, but the schema does not constrain it), so take the
      // newest and treat "none" as "this media is not a look".
      lookPostPrimaryFor: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { caption: true },
      },
    },
  })
  if (!media) return null

  // ⚠️ Imported HERE, not at module scope. `lib/media/renderUrls` builds a
  // Supabase admin client while it is being evaluated, so a static import puts
  // "Missing env var: NEXT_PUBLIC_SUPABASE_URL" into the import graph of every
  // module that reaches this one — including the availability bootstrap route,
  // which several integration tests import directly and which has no reason to
  // need storage credentials to answer "when is this pro free?". Reached only
  // once a cover is actually being resolved.
  const rendered = await renderMediaUrls(media)
  const caption = media.lookPostPrimaryFor[0]?.caption ?? null

  return {
    imageUrl: rendered.renderUrl ?? rendered.renderThumbUrl ?? null,
    lookName: caption ? lookNameFromCaption(caption) : null,
  }
}
