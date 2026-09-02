// lib/media/mediaVisibility.ts
//
// Single source of truth for the relationship between a MediaAsset's
// `storageBucket` and its `visibility`, and for "may the public see this row".
//
// 🔴 Why this module exists.
//
// `lib/media/recordMediaAsset.ts` has always asserted the bucket/visibility
// invariant — but only on CREATE. Every UPDATE path hand-rolled its own
// flags → visibility function and wrote the result straight to Prisma, with no
// bucket in the calculation at all. Three copies existed:
//
//   app/api/v1/pro/media/route.ts          computeVisibility()
//   app/api/v1/pro/media/[id]/portfolio/…  computeVisibility()
//   app/api/v1/pro/media/[id]/route.ts     normalizeVisibilityFromFlags()
//
// All three read `featured || looksEligible ? PUBLIC : PRO_CLIENT`. On the
// CREATE path that is safe, because the route then cross-checks the result
// against the bucket and refuses a mismatch. On the two UPDATE paths — the
// portfolio DELETE ("remove from portfolio") and the media PATCH (un-tick
// "featured" / "eligible for Looks") — nothing checked the bucket, so
// retracting a photo the pro had uploaded to `media-public` stamped it
// `PRO_CLIENT` while the bytes stayed world-readable.
//
// That produced 3 rows in production (found 2026-09-01): visibility
// `PRO_CLIENT`, bucket `media-public`, an unauthenticated GET returning
// HTTP 200 and the full file. The column claimed a privacy the storage did not
// provide, which makes it useless as an audit signal for every other row.
//
// 🔴 Why retracting does NOT move the bytes to the private bucket.
//
// The obvious "fix" — copy the object into `media-private` on retract so
// `PRO_CLIENT` becomes true — is wrong here, and would be worse than the bug.
// `lib/media/publicShareGuard.ts` treats *living in the private bucket* as one
// of its two client-linkage signals, so an asset with no `bookingId` and no
// `reviewId` that were moved to `media-private` becomes permanently
// unpublishable: `canProSharePublicly()` refuses it, and the pro could never
// re-feature their own photograph. Un-featuring once would brick the row.
//
// So the model is the one the codebase already had, just made explicit:
//
//   `visibility` describes WHERE THE BYTES LIVE and who may fetch the URL.
//   The flags (+ the backing LookPost's status) describe WHETHER IT IS SHOWN.
//
// A pro's own upload in `media-public` is `PUBLIC` for as long as it sits
// there — that is simply true, and pretending otherwise is what caused this
// defect. Withdrawal is expressed by clearing `isFeaturedInPortfolio` /
// `isEligibleForLooks` and retracting the LookPost to DRAFT, which is exactly
// what the retract paths already do and what every read surface already keys
// on. {@link isPubliclyViewableMediaAsset} is that read-side question.

import { MediaVisibility } from '@prisma/client'

import { BUCKETS } from '@/lib/storageBuckets'

/**
 * The invariant, as a predicate: `PRO_CLIENT` media must live in the private
 * bucket, because `media-public` is world-readable by URL.
 *
 * Asserted on create by `assertMediaAssetInvariant`, and made unreachable on
 * update by {@link resolveMediaVisibility}.
 */
export function isVisibilityAllowedForBucket(args: {
  storageBucket: string
  visibility: MediaVisibility
}): boolean {
  if (args.visibility !== MediaVisibility.PRO_CLIENT) return true

  return args.storageBucket === BUCKETS.mediaPrivate
}

/**
 * The visibility a stored asset may legitimately carry, given where its bytes
 * live and whether the pro is currently showing it.
 *
 * This is the update-side counterpart to `buildMediaAssetCreateData`: it can
 * only ever return a bucket-legal value, so a caller cannot express the broken
 * state even by accident.
 *
 * - Shown (featured or Looks-eligible) → `PUBLIC`. The create path's consent
 *   gate (`canProSharePublicly`) is what decides whether a row is *allowed* to
 *   get here; this function does not re-litigate consent, it only refuses to
 *   under-report the bucket.
 * - Not shown, private bucket → `PRO_CLIENT`. The bytes really are private.
 * - Not shown, public bucket → `PUBLIC`. The bytes are world-readable whatever
 *   the column says; claiming `PRO_CLIENT` here is the bug this module closes.
 *   The asset drops off every public surface via the flags — see
 *   {@link isPubliclyViewableMediaAsset}.
 */
export function resolveMediaVisibility(args: {
  storageBucket: string
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
}): MediaVisibility {
  if (args.isFeaturedInPortfolio || args.isEligibleForLooks) {
    return MediaVisibility.PUBLIC
  }

  return args.storageBucket === BUCKETS.mediaPrivate
    ? MediaVisibility.PRO_CLIENT
    : MediaVisibility.PUBLIC
}

/**
 * Whether an anonymous viewer may be shown this asset on a public surface
 * (`/media/[id]`, the unauthenticated branch of `GET /api/v1/media/url`).
 *
 * 🔴 `visibility === PUBLIC` alone is NOT this question, and reading it as if
 * it were is what made {@link resolveMediaVisibility} necessary to get right.
 * Since a retracted public-bucket asset now correctly stays `PUBLIC`, the
 * surfaces have to ask about the flags, or un-featuring a photo would stop
 * taking it off the page.
 *
 * The three ways a row earns a public surface:
 * - `isFeaturedInPortfolio` — the pro put it on their grid.
 * - `isEligibleForLooks` — the pro published it to the feed.
 * - `reviewId` — the CLIENT promoted it by attaching it to a review. Review
 *   media is written `PUBLIC` with BOTH flags false
 *   (`app/api/v1/client/bookings/[id]/review/route.ts`), so omitting this
 *   clause would 404 every review photo.
 */
export function isPubliclyViewableMediaAsset(args: {
  visibility: MediaVisibility
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
  reviewId: string | null
}): boolean {
  if (args.visibility !== MediaVisibility.PUBLIC) return false

  return Boolean(
    args.isFeaturedInPortfolio || args.isEligibleForLooks || args.reviewId,
  )
}
