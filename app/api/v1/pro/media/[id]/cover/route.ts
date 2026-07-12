// app/api/v1/pro/media/[id]/cover/route.ts
//
// §18d — owner cover editor write path. Sets/clears the pro's creator-page cover
// banner (`ProfessionalProfile.coverMediaAssetId`, the §18a read side). The cover
// renders publicly on the profile hero, so it may only point at an IMAGE the pro
// owns that is publicly shareable — the same client-consent gate the portfolio
// feature route enforces (canProSharePublicly), so a private/unconsented session
// photo can never leak onto a public banner.
import { NextRequest } from 'next/server'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  canProSharePublicly,
  UNPROMOTED_MEDIA_MESSAGE,
} from '@/lib/media/publicShareGuard'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'
import { MediaType } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function loadOwnedMedia(mediaId: string, professionalId: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      professionalId: true,
      mediaType: true,
      // Consent inputs — a cover renders publicly, so reuse the public-share gate.
      storageBucket: true,
      reviewId: true,
      booking: { select: { mediaUseConsentAt: true } },
    },
  })

  if (!media) return { ok: false as const, status: 404, error: 'Media not found.' }
  if (media.professionalId !== professionalId) {
    return { ok: false as const, status: 403, error: 'Forbidden.' }
  }
  return { ok: true as const, media }
}

// POST — set this media as the pro's cover banner.
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

    // A banner is an image; a video can't back the cover hero.
    if (owned.media.mediaType !== MediaType.IMAGE) {
      return jsonFail(400, 'Cover photo must be an image.')
    }

    // Consent gate: a client's private session photo can only become a public
    // cover after the client added it to a review or granted aftercare consent.
    if (
      !canProSharePublicly({
        storageBucket: owned.media.storageBucket,
        reviewId: owned.media.reviewId,
        clientUseConsentAt: owned.media.booking?.mediaUseConsentAt ?? null,
      })
    ) {
      return jsonFail(403, UNPROMOTED_MEDIA_MESSAGE)
    }

    await prisma.professionalProfile.update({
      where: { id: professionalId },
      data: { coverMediaAssetId: mediaId },
      select: { id: true },
    })

    return jsonOk({ coverMediaAssetId: mediaId }, 200)
  } catch (e: unknown) {
    console.error('POST /api/v1/pro/media/[id]/cover error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Internal server error')
  }
}

// DELETE — clear the cover, but only when THIS media is the current cover (so a
// "remove cover" tap on one tile can never wipe a cover set to another). No-op +
// still 200 when it isn't the cover, keeping the control idempotent.
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    await prisma.professionalProfile.updateMany({
      where: { id: professionalId, coverMediaAssetId: mediaId },
      data: { coverMediaAssetId: null },
    })

    return jsonOk({ coverMediaAssetId: null }, 200)
  } catch (e: unknown) {
    console.error('DELETE /api/v1/pro/media/[id]/cover error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Internal server error')
  }
}
