// app/api/v1/pro/media/[id]/portfolio/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { resolveStoragePointers, safeUrl } from '@/lib/media'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import {
  parseBeforeAssetField,
  resolveFeaturePairing,
} from '@/lib/media/portfolioPairing'
import { canProSharePublicly, UNPROMOTED_MEDIA_MESSAGE } from '@/lib/media/publicShareGuard'
import { resolveMediaVisibility } from '@/lib/media/mediaVisibility'
import {
  attemptRetraction,
  RETRACTED_VISIBILITY,
  RETRACTION_SELECT,
} from '@/lib/media/retractToPrivateBucket'
import { reconcilePortfolioLookForMediaAsset } from '@/lib/looks/publication/portfolioLookSync'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

async function loadOwnedMedia(mediaId: string, professionalId: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      professionalId: true,
      reviewId: true,
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      visibility: true,
      // Needed to auto-pair the featured "after" with its booking's "before".
      bookingId: true,
      phase: true,
      mediaType: true,
      // B3b: the booking's client media-use consent also unlocks public sharing.
      booking: { select: { mediaUseConsentAt: true } },

      // Canonical pointers
      storageBucket: true,
      storagePath: true,
      thumbBucket: true,
      thumbPath: true,

      // Legacy fallbacks
      url: true,
      thumbUrl: true,

      // Who published the look this asset backs, if any (primaryMediaAssetId is
      // @unique, so there is at most one).
      lookPostPrimaryFor: { select: { clientAuthorId: true }, take: 1 },
    },
  })

  if (!media) return { ok: false as const, status: 404, error: 'Media not found.' }
  if (media.professionalId !== professionalId) return { ok: false as const, status: 403, error: 'Forbidden.' }

  // 🔴 A CLIENT-authored look is not the pro's to publish or to retract, even
  // though the asset carries their `professionalId` (it depicts their work).
  //
  // Without this, DELETE answered 200 and flipped the asset to PRO_CLIENT /
  // un-featured while `reconcilePortfolioLookForMediaAsset` skipped the retract
  // (`SKIPPED_CLIENT_LOOK`) — so the look stayed PUBLISHED and live in the feed
  // and on the client's own grid, the pro was told it had come down, and the
  // asset was left marked private underneath a public post. Refusing at the
  // route closes it for every caller, not just for the screen that hides the
  // button.
  if (media.lookPostPrimaryFor[0]?.clientAuthorId) {
    return {
      ok: false as const,
      status: 403,
      error: CLIENT_AUTHORED_LOOK_MESSAGE,
    }
  }

  return { ok: true as const, media }
}

export const CLIENT_AUTHORED_LOOK_MESSAGE =
  'Your client posted this Look, so it is theirs to take down — not yours.'

/**
 * Optional: if you have old rows where storageBucket/path is missing but url exists,
 * attempt to backfill canonical pointers from the url(s).
 *
 * This keeps your app moving toward a single source of truth without a separate script.
 *
 * 🔴 This is the ONLY update in the codebase that writes `storageBucket`, which
 * makes it the third way into the bucket/visibility defect — from the other
 * direction. A legacy row with an empty bucket, a `media-public` url and
 * `visibility = PRO_CLIENT` would have had its bucket resolved to the
 * world-readable one while the column kept claiming private. Latent rather than
 * live (0 of 96 production rows have an empty bucket, measured 2026-09-01), but
 * free to close: the derived bucket is fed straight back through
 * `resolveMediaVisibility` in the SAME statement, so the row cannot be observed
 * in the broken state even for an instant.
 */
async function backfillPointersIfMissing(mediaId: string, m: {
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
}): Promise<string> {
  const hasPointers = Boolean(m.storageBucket && m.storagePath)
  if (hasPointers) return m.storageBucket

  const url = safeUrl(m.url)
  if (!url) return m.storageBucket

  const ptrs = resolveStoragePointers({
    url,
    thumbUrl: safeUrl(m.thumbUrl),
    storageBucket: m.storageBucket || null,
    storagePath: m.storagePath || null,
    thumbBucket: m.thumbBucket,
    thumbPath: m.thumbPath,
  })
  if (!ptrs) return m.storageBucket

  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      storageBucket: ptrs.storageBucket,
      storagePath: ptrs.storagePath,
      thumbBucket: ptrs.thumbBucket,
      thumbPath: ptrs.thumbPath,
      // Learning where the bytes actually live can change what visibility is
      // legal for this row, so the two move together.
      visibility: resolveMediaVisibility({
        storageBucket: ptrs.storageBucket,
        isFeaturedInPortfolio: m.isFeaturedInPortfolio,
        isEligibleForLooks: m.isEligibleForLooks,
      }),
    },
    select: { id: true },
  })

  // 🔴 Returned, not discarded. The retract below has to resolve visibility
  // against where the bytes turned out to be — reading the caller's stale,
  // pre-backfill `storageBucket` would judge a legacy row on a value this
  // function just replaced.
  return ptrs.storageBucket
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    const owned = await loadOwnedMedia(mediaId, professionalId)
    if (!owned.ok) return jsonFail(owned.status, owned.error)

    // Consent gate: a client's private session photo can only be featured
    // publicly after the client added it to a review (which sets reviewId).
    if (!canProSharePublicly({
      bookingId: owned.media.bookingId,
      storageBucket: owned.media.storageBucket,
      reviewId: owned.media.reviewId,
      clientUseConsentAt: owned.media.booking?.mediaUseConsentAt ?? null,
    })) {
      return jsonFail(403, UNPROMOTED_MEDIA_MESSAGE)
    }

    // Optional: move old rows toward canonical pointers
    const storageBucket = await backfillPointersIfMissing(mediaId, owned.media)

    // Opt-in before/after pairing (default-on): an explicit body wins, otherwise
    // auto-pair with the booking's before so the portfolio tile can render the
    // comparison slider. The pro can unpair later by sending `beforeAssetId:null`.
    const pairing = await resolveFeaturePairing({
      afterAssetId: mediaId,
      professionalId,
      media: owned.media,
      pairField: parseBeforeAssetField(await req.json().catch(() => null)),
    })
    if (!pairing.ok) return jsonFail(400, pairing.error)
    const beforeAssetId = pairing.beforeAssetId

    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        isFeaturedInPortfolio: true,
        visibility: resolveMediaVisibility({
          storageBucket,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: owned.media.isEligibleForLooks,
        }),
        beforeAssetId,
      },
      select: {
        id: true,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
        visibility: true,
        beforeAssetId: true,

        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
      },
    })

    // §19b: featuring to portfolio publishes a Look (the single public-content
    // atom) so featured work reaches the feed/search/boards, not just the grid.
    await reconcilePortfolioLookForMediaAsset(prisma, {
      professionalId,
      mediaAssetId: mediaId,
    })

    // `tile`, matching the grid this asset is being handed back to (the GET on
    // /api/v1/pro/media). Without it, featuring a photo would swap its tile from
    // a 512px render to the multi-megabyte stored original.
    const { renderUrl, renderThumbUrl } = await renderMediaUrls(updated, {
      variant: 'tile',
    })

    return jsonOk(
      {
        media: {
          ...updated,
          url: renderUrl,
          thumbUrl: renderThumbUrl,
        },
      },
      200,
    )
  } catch (e: unknown) {
    console.error('POST /api/v1/pro/media/[id]/portfolio error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Internal server error')
  }
}
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    const owned = await loadOwnedMedia(mediaId, professionalId)
    if (!owned.ok) return jsonFail(owned.status, owned.error)

    // Optional: move old rows toward canonical pointers
    const storageBucket = await backfillPointersIfMissing(mediaId, owned.media)

    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        // §19b: removing from the portfolio is the unified "unpublish" — the grid
        // and the feed are one surface now, so clear Looks-eligibility too and let
        // the reconcile below retract the live LookPost (fixes divergence b).
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
        // 🔴 Bucket-aware. This used to write PRO_CLIENT unconditionally, which
        // stamped "private" on assets whose bytes sit in the world-readable
        // media-public bucket — the pro's own Looks/portfolio uploads. The row
        // still drops off every public surface, via the flags above and the
        // LookPost the reconcile below retracts to DRAFT.
        visibility: resolveMediaVisibility({
          storageBucket,
          isFeaturedInPortfolio: false,
          isEligibleForLooks: false,
        }),
        // Unpair on removal — a tile that's no longer featured shouldn't keep a
        // dangling before/after pairing.
        beforeAssetId: null,
      },
      select: {
        id: true,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
        visibility: true,
        beforeAssetId: true,

        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
      },
    })

    // §19b: retract the published Look now that the asset is no longer public.
    await reconcilePortfolioLookForMediaAsset(prisma, {
      professionalId,
      mediaAssetId: mediaId,
    })

    // 🔴 Take the BYTES down, not just the label. Until this existed, removing a
    // photo from the portfolio left the object sitting in the world-readable
    // bucket, so anyone holding the URL kept the full-resolution file forever.
    // Runs last, against committed state, and only if nothing still shows the
    // asset.
    const retractionCandidate = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: RETRACTION_SELECT,
    })
    const retraction = await attemptRetraction(prisma, retractionCandidate)

    // The pointers moved, so the response must describe where the bytes are NOW
    // — rendering `updated` would sign a path that no longer exists.
    const responseMedia =
      retraction.status === 'RETRACTED'
        ? {
            ...updated,
            visibility: RETRACTED_VISIBILITY,
            storageBucket: retraction.storageBucket,
            storagePath: retraction.storagePath,
            thumbBucket: retraction.thumbBucket,
            thumbPath: retraction.thumbPath,
            url: null,
            thumbUrl: null,
          }
        : updated

    // `tile`, matching the grid this asset is being handed back to (the GET on
    // /api/v1/pro/media). Without it, featuring a photo would swap its tile from
    // a 512px render to the multi-megabyte stored original.
    const { renderUrl, renderThumbUrl } = await renderMediaUrls(responseMedia, {
      variant: 'tile',
    })

    return jsonOk(
      {
        media: {
          ...responseMedia,
          url: renderUrl,
          thumbUrl: renderThumbUrl,
        },
      },
      200,
    )
  } catch (e: unknown) {
    console.error('DELETE /api/v1/pro/media/[id]/portfolio error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Internal server error')
  }
}