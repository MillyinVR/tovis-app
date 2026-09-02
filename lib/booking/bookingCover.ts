// lib/booking/bookingCover.ts
//
// The image and name of the look a booking is being made FROM — the cover the
// booking sheet opens with ("Booking this look"), and the thumbnail the add-ons
// step carries over so the second screen still names what you are booking.
//
// Resolved from the `mediaId` the booking flow already threads through every
// surface, so nothing new has to be plumbed from the look feed.
import { type Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isPubliclyViewableMediaAsset } from '@/lib/media/mediaVisibility'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { lookNameFromCaption } from '@/lib/looks/publication/clientLookService'

export type BookingCover = {
  /**
   * The downscaled `feed` render when the asset can be rendered on the fly,
   * else the stored original. A phone capture is ~4.5 MB at 3024×4032; the
   * sheet paints it into a 780×264 well.
   */
  imageUrl: string | null
  /**
   * The stored original, ONLY when `imageUrl` is a derived render of it — so a
   * client can fall back if the render endpoint stops serving (it is a
   * documented Pro-plan feature; see `lib/media/imageTransform.ts`). Null when
   * `imageUrl` already IS the original, so nothing retries the same URL.
   */
  fallbackImageUrl: string | null
  /** The look's display name, or null when this media is not a published look. */
  lookName: string | null
}

/**
 * `null` when there is no media (a booking started from a pro's profile rather
 * than from a look) — the sheet then renders its cover-less header rather than
 * an empty photo well.
 *
 * ⚠️ Publicly-viewable media only. A booking can be started from a look whose
 * media has since been retracted, and a signed URL for private media has no
 * business being minted into a booking sheet — the cover is decoration, not an
 * entitlement.
 *
 * 🔴 The test is `isPubliclyViewableMediaAsset`, not `visibility === PUBLIC`. A
 * pro's own public-bucket upload keeps visibility PUBLIC once retracted (see
 * lib/media/mediaVisibility.ts); the flags are what say it came down. Filtering
 * on the column alone would start handing back covers for retracted looks.
 */
export async function loadBookingCover(
  mediaId: string | null | undefined,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<BookingCover | null> {
  const id = typeof mediaId === 'string' ? mediaId.trim() : ''
  if (!id) return null

  const media = await db.mediaAsset.findFirst({
    where: { id },
    select: {
      visibility: true,
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      reviewId: true,
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
  if (
    !isPubliclyViewableMediaAsset({
      visibility: media.visibility,
      isFeaturedInPortfolio: media.isFeaturedInPortfolio,
      isEligibleForLooks: media.isEligibleForLooks,
      reviewId: media.reviewId,
    })
  ) {
    return null
  }

  // ⚠️ Imported HERE, not at module scope. `lib/media/renderUrls` builds a
  // Supabase admin client while it is being evaluated, so a static import puts
  // "Missing env var: NEXT_PUBLIC_SUPABASE_URL" into the import graph of every
  // module that reaches this one — including the availability bootstrap route,
  // which several integration tests import directly and which has no reason to
  // need storage credentials to answer "when is this pro free?". Reached only
  // once a cover is actually being resolved.
  // `feed`, not `tile`: the same URL serves the sheet's full-width cover (780px
  // wide on web, edge to edge on iOS) and the add-ons strip's 38px thumbnail,
  // and the wider one has to look right.
  const rendered = await renderMediaUrls(media, { variant: 'feed' })
  const caption = media.lookPostPrimaryFor[0]?.caption ?? null

  // The render first. This used to be `renderUrl ?? renderThumbUrl`, which —
  // with no stored thumb on any row — put the multi-megabyte original into a
  // 264px-tall well on every booking sheet.
  const imageUrl = rendered.renderThumbUrl ?? rendered.renderUrl ?? null
  const fallbackImageUrl =
    rendered.renderUrl && rendered.renderUrl !== imageUrl
      ? rendered.renderUrl
      : null

  return {
    imageUrl,
    fallbackImageUrl,
    lookName: caption ? lookNameFromCaption(caption) : null,
  }
}
