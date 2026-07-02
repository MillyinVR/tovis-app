// app/api/v1/pro/media/[id]/portfolio/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { MediaPhase, MediaType, MediaVisibility } from '@prisma/client'
import { resolveStoragePointers, safeUrl } from '@/lib/media'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { loadPrimaryBeforeAssetId } from '@/lib/media/bookingBeforeAfter'
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

type PairField = { present: boolean; value: string | null }

/**
 * Read an optional `beforeAssetId` from the feature request body, distinguishing
 * three cases: omitted (auto-pair from the booking, the default-on behaviour),
 * an explicit id (pair with that specific before), or explicit null / non-string
 * (unpair). Callers that just toggle the feature flag send no body → auto-pair.
 */
function parseBeforeAssetField(body: unknown): PairField {
  if (!body || typeof body !== 'object' || !('beforeAssetId' in body)) {
    return { present: false, value: null }
  }
  const raw = (body as Record<string, unknown>).beforeAssetId
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return { present: true, value: trimmed.length > 0 ? trimmed : null }
  }
  return { present: true, value: null }
}

/**
 * Validate an explicitly-chosen "before": it must be another photo owned by the
 * same pro (never a video, never the after itself). Keeps a pro from pairing
 * across tenants or with a foreign asset id.
 */
async function validateExplicitBefore(
  beforeAssetId: string,
  professionalId: string,
  afterAssetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (beforeAssetId === afterAssetId) {
    return { ok: false, error: 'A photo can’t be paired with itself.' }
  }
  const before = await prisma.mediaAsset.findUnique({
    where: { id: beforeAssetId },
    select: { id: true, professionalId: true, mediaType: true },
  })
  if (!before || before.professionalId !== professionalId) {
    return { ok: false, error: 'Before photo not found.' }
  }
  if (before.mediaType !== MediaType.IMAGE) {
    return { ok: false, error: 'A before/after pair must both be photos.' }
  }
  return { ok: true }
}

/**
 * Default-on pairing: when a pro features an "after" that came from a booking,
 * pair it with that booking's primary before. Skips videos and BEFORE-phase
 * photos (a before isn't an "after"), and assets with no booking.
 */
async function resolveAutoPairedBefore(
  media: { mediaType: MediaType; phase: MediaPhase; bookingId: string | null },
  afterAssetId: string,
): Promise<string | null> {
  if (media.mediaType !== MediaType.IMAGE) return null
  if (media.phase === MediaPhase.BEFORE) return null
  if (!media.bookingId) return null
  return loadPrimaryBeforeAssetId(media.bookingId, afterAssetId)
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
      storageBucket: owned.media.storageBucket,
      reviewId: owned.media.reviewId,
      clientUseConsentAt: owned.media.booking?.mediaUseConsentAt ?? null,
    })) {
      return jsonFail(403, UNPROMOTED_MEDIA_MESSAGE)
    }

    // Optional: move old rows toward canonical pointers
    await backfillPointersIfMissing(mediaId, owned.media)

    // Opt-in before/after pairing (default-on): an explicit body wins, otherwise
    // auto-pair with the booking's before so the portfolio tile can render the
    // comparison slider. The pro can unpair later by sending `beforeAssetId:null`.
    const pairField = parseBeforeAssetField(await req.json().catch(() => null))
    let beforeAssetId: string | null
    if (pairField.present) {
      if (pairField.value === null) {
        beforeAssetId = null
      } else {
        const check = await validateExplicitBefore(
          pairField.value,
          professionalId,
          mediaId,
        )
        if (!check.ok) return jsonFail(400, check.error)
        beforeAssetId = pairField.value
      }
    } else {
      beforeAssetId = await resolveAutoPairedBefore(owned.media, mediaId)
    }

    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        isFeaturedInPortfolio: true,
        visibility: computeVisibility(true, owned.media.isEligibleForLooks),
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