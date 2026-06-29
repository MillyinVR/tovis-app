// app/api/v1/pro/media/[id]/portfolio/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { MediaVisibility } from '@prisma/client'
import { resolveStoragePointers, safeUrl } from '@/lib/media'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { canProSharePublicly, UNPROMOTED_MEDIA_MESSAGE } from '@/lib/media/publicShareGuard'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

function computeVisibility(isFeaturedInPortfolio: boolean, isEligibleForLooks: boolean): MediaVisibility {
  return isFeaturedInPortfolio || isEligibleForLooks ? MediaVisibility.PUBLIC : MediaVisibility.PRO_CLIENT
}

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
    },
  })

  if (!media) return { ok: false as const, status: 404, error: 'Media not found.' }
  if (media.professionalId !== professionalId) return { ok: false as const, status: 403, error: 'Forbidden.' }
  return { ok: true as const, media }
}

/**
 * Optional: if you have old rows where storageBucket/path is missing but url exists,
 * attempt to backfill canonical pointers from the url(s).
 *
 * This keeps your app moving toward a single source of truth without a separate script.
 */
async function backfillPointersIfMissing(mediaId: string, m: {
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
}) {
  const hasPointers = Boolean(m.storageBucket && m.storagePath)
  if (hasPointers) return

  const url = safeUrl(m.url)
  if (!url) return

  const ptrs = resolveStoragePointers({
    url,
    thumbUrl: safeUrl(m.thumbUrl),
    storageBucket: m.storageBucket || null,
    storagePath: m.storagePath || null,
    thumbBucket: m.thumbBucket,
    thumbPath: m.thumbPath,
  })
  if (!ptrs) return

  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      storageBucket: ptrs.storageBucket,
      storagePath: ptrs.storagePath,
      thumbBucket: ptrs.thumbBucket,
      thumbPath: ptrs.thumbPath,
    },
    select: { id: true },
  })
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
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
      storageBucket: owned.media.storageBucket,
      reviewId: owned.media.reviewId,
      clientUseConsentAt: owned.media.booking?.mediaUseConsentAt ?? null,
    })) {
      return jsonFail(403, UNPROMOTED_MEDIA_MESSAGE)
    }

    // Optional: move old rows toward canonical pointers
    await backfillPointersIfMissing(mediaId, owned.media)

    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        isFeaturedInPortfolio: true,
        visibility: computeVisibility(true, owned.media.isEligibleForLooks),
      },
      select: {
        id: true,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
        visibility: true,

        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
      },
    })

    const { renderUrl, renderThumbUrl } = await renderMediaUrls(updated)

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
    await backfillPointersIfMissing(mediaId, owned.media)

    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        isFeaturedInPortfolio: false,
        visibility: computeVisibility(false, owned.media.isEligibleForLooks),
      },
      select: {
        id: true,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
        visibility: true,

        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
      },
    })

    const { renderUrl, renderThumbUrl } = await renderMediaUrls(updated)

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
    console.error('DELETE /api/v1/pro/media/[id]/portfolio error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Internal server error')
  }
}