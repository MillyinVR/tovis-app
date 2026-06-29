// lib/media/publicShareGuard.ts
//
// Single source of truth for: "may a professional make this media asset public?"
//
// Client safety contract (see docs/launch-readiness/handoff.md — media is
// safety-critical): a client's private BEFORE/AFTER session photos must NEVER
// become public unless the CLIENT authorizes it. The authorization act is the
// client attaching the photo to a review, which stamps `reviewId` and flips the
// row to PUBLIC (app/api/v1/client/bookings/[id]/review/route.ts).
//
// Therefore a pro may flip a media asset to public (feature in portfolio, mark
// eligible for Looks, or back a published Look) ONLY when the asset is either:
//   - already public-bucket media (the pro's own portfolio/Looks uploads, which
//     are forced into media-public at create time), or
//   - review-promoted media (`reviewId` is set — the client consented).
//
// Anything still sitting in the private bucket with no review link is
// unpromoted private media and must not be published by the pro.

import { BUCKETS } from '@/lib/storageBuckets'

export type PublicShareCandidate = {
  storageBucket: string | null
  reviewId: string | null
  // B3b: the client granted media-use consent for this asset via the aftercare
  // summary — a second client-authorized unlock alongside review-promotion.
  clientUseConsentAt?: Date | string | null
}

/**
 * True when the media is private-bucket media the client has NOT authorized for
 * public use — i.e. it must not be made public by the pro. The client authorizes
 * it either by attaching it to a review (`reviewId`) or by granting media-use
 * consent in the aftercare summary (`clientUseConsentAt`).
 */
export function isUnpromotedPrivateMedia(media: PublicShareCandidate): boolean {
  const inPrivateBucket = media.storageBucket === BUCKETS.mediaPrivate
  const clientAuthorized = Boolean(media.reviewId) || Boolean(media.clientUseConsentAt)
  return inPrivateBucket && !clientAuthorized
}

/** Inverse of {@link isUnpromotedPrivateMedia}. */
export function canProSharePublicly(media: PublicShareCandidate): boolean {
  return !isUnpromotedPrivateMedia(media)
}

export const UNPROMOTED_MEDIA_MESSAGE =
  'This session photo can only be shared publicly after the client adds it to a review or allows it in their aftercare.'
