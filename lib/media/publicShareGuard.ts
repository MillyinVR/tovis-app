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

import { Role } from '@prisma/client'

import { BUCKETS } from '@/lib/storageBuckets'

export type PublicShareCandidate = {
  /**
   * 🔴 REQUIRED, deliberately — not optional like the fields below.
   *
   * This is the PROVENANCE signal: a photo attached to a booking was taken
   * during someone's appointment, so it is theirs to release. An optional field
   * here would fail OPEN — a caller that forgot to select `bookingId` would
   * silently classify a client's session photo as the pro's to publish. Making
   * it required means the compiler, not a reviewer, catches that.
   */
  bookingId: string | null
  /**
   * Where the bytes live. Retained as belt-and-braces only — it must never
   * again be the *sole* input, see the note on the function below.
   */
  storageBucket: string | null
  /**
   * Set when the bytes were withdrawn from the public bucket by a pro retracting
   * their OWN upload (`lib/media/retractToPrivateBucket.ts`). It disarms the
   * bucket half of the client-linkage test, and nothing else — see the note on
   * {@link isUnpromotedPrivateMedia}.
   */
  retractedFromPublicAt?: Date | string | null
  reviewId: string | null
  // B3b: the client granted media-use consent for this asset via the aftercare
  // summary — a second client-authorized unlock alongside review-promotion.
  clientUseConsentAt?: Date | string | null
  /**
   * Who uploaded it. A photo the CLIENT uploaded themselves is already theirs
   * to publish — the act of uploading is the authorization. Server-derived from
   * the authenticated actor, never client-supplied.
   */
  uploadedByRole?: Role | null
}

/**
 * True when this is client-linked media the client has NOT authorized for public
 * use — i.e. the pro must not be able to make it public. The client authorizes
 * it either by attaching it to a review (`reviewId`) or by granting media-use
 * consent in their aftercare (`clientUseConsentAt`).
 *
 * 🔴 Why provenance and not just the bucket. This used to be exactly
 * `storageBucket === BUCKETS.mediaPrivate && !authorized`, which keyed a
 * CLIENT-SAFETY decision on where the bytes happened to be stored. That failed
 * OPEN — every asset whose bucket was not byte-identical to `'media-private'`
 * (a null bucket, a renamed bucket, a new upload path, a test fixture) was
 * classified as the pro's to publish. A storage migration would silently have
 * become a permissions change, with no test failing.
 *
 * The two signals are perfectly correlated in production today (measured
 * 2026-08-15: 69/69 private-bucket assets are session photos, and the change
 * reclassified 0 rows in either direction), which is precisely why the coupling
 * was invisible — and why it was cheap to separate before they ever diverge.
 *
 * The bucket check stays as a second, independent reason to refuse. Either
 * signal alone is enough to hold a photo back.
 */
export function isUnpromotedPrivateMedia(media: PublicShareCandidate): boolean {
  // 🔴 A retracted pro upload sits in the private bucket for a reason that has
  // nothing to do with a client. Before true retraction existed, "in
  // media-private" and "is client media" were perfectly correlated, so the
  // bucket could stand in for provenance. Retraction BREAKS that correlation by
  // design: it moves the pro's own photograph there on purpose. Reading the
  // bucket alone would then refuse the pro their own work forever — un-featuring
  // once would brick the row — so the bucket signal is disarmed exactly when we
  // recorded why the bytes moved, and never otherwise.
  //
  // This is deliberately NOT an authorization: `bookingId` below is untouched,
  // so a photo shot during someone's appointment is still held back whatever
  // bucket it is in, and an asset with no recorded retraction is still judged by
  // the bucket exactly as before.
  const bucketImpliesClientLink =
    media.storageBucket === BUCKETS.mediaPrivate &&
    !media.retractedFromPublicAt

  const clientLinked = Boolean(media.bookingId) || bucketImpliesClientLink

  const clientAuthorized =
    Boolean(media.reviewId) ||
    Boolean(media.clientUseConsentAt) ||
    // 🔴 The question this answers is "may the PRO share this publicly". A photo
    // the CLIENT uploaded is their own work being published by its own subject,
    // so there is nobody to protect them from — uploading it IS the consent.
    // Without this, a client publishing their own after-photo from a visit is
    // refused, because the photo carries the visit's `bookingId`.
    media.uploadedByRole === Role.CLIENT

  return clientLinked && !clientAuthorized
}

/** Inverse of {@link isUnpromotedPrivateMedia}. */
export function canProSharePublicly(media: PublicShareCandidate): boolean {
  return !isUnpromotedPrivateMedia(media)
}

export const UNPROMOTED_MEDIA_MESSAGE =
  'This session photo can only be shared publicly after the client adds it to a review or allows it in their aftercare.'
