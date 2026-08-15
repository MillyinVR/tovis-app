// app/api/v1/pro/media/[id]/signature/route.ts
//
// Owner write path for the pro's SIGNATURE post
// (`ProfessionalProfile.signatureMediaAssetId`) — one optional, pro-chosen piece
// of their own work, promoted above the portfolio grid on the public profile.
//
// 🔴 "Signature", never "Spotlight" (that is `LookPost.featuredAt`, a SUPER_ADMIN
// editorial pick) and never "Featured" (four other meanings already). See the
// schema comment on `signatureMediaAssetId`.
//
// Modelled on the cover route beside it, with the same ownership + public-share
// consent gates, plus one this surface needs and the cover does not: the media
// must already be a PUBLICLY VISIBLE look of this pro. The public read applies
// exactly that clause, so without this check a pro could "set" a signature, get
// a 200, and see nothing appear — a control that reports success while the
// server quietly refuses the claim.
import { NextRequest } from 'next/server'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { proOwnPublicLooksWhere } from '@/lib/looks/selects'
import {
  canProSharePublicly,
  UNPROMOTED_MEDIA_MESSAGE,
} from '@/lib/media/publicShareGuard'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'
import { MediaType } from '@prisma/client'

export const dynamic = 'force-dynamic'

const NOT_PUBLIC_LOOK_MESSAGE =
  'Only a published, approved photo from your portfolio can be your Signature.'

// POST — set this media as the pro's Signature post.
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    const media = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        professionalId: true,
        mediaType: true,
        // Consent inputs — a Signature renders publicly, so reuse the same
        // public-share gate the cover and portfolio-feature routes apply.
        storageBucket: true,
        reviewId: true,
        // Provenance for the consent gate: a photo taken during a booking is
        // the client's to release, whatever bucket it sits in.
        bookingId: true,
        booking: { select: { mediaUseConsentAt: true } },
      },
    })

    if (!media) return jsonFail(404, 'Media not found.')
    if (media.professionalId !== professionalId) {
      return jsonFail(403, 'Forbidden.')
    }

    // The block renders a still (or a before/after comparison of two stills), so
    // a video can't back it.
    if (media.mediaType !== MediaType.IMAGE) {
      return jsonFail(400, 'Your Signature must be a photo.')
    }

    if (
      !canProSharePublicly({
        bookingId: media.bookingId,
        storageBucket: media.storageBucket,
        reviewId: media.reviewId,
        clientUseConsentAt: media.booking?.mediaUseConsentAt ?? null,
      })
    ) {
      return jsonFail(403, UNPROMOTED_MEDIA_MESSAGE)
    }

    // The exact clause the public profile reads with. Refuse here rather than
    // storing a choice the profile would silently decline to render.
    const publicLook = await prisma.lookPost.findFirst({
      where: {
        professionalId,
        primaryMediaAssetId: mediaId,
        ...proOwnPublicLooksWhere,
      },
      select: { id: true },
    })

    if (!publicLook) return jsonFail(409, NOT_PUBLIC_LOOK_MESSAGE)

    await prisma.professionalProfile.update({
      where: { id: professionalId },
      data: { signatureMediaAssetId: mediaId },
      select: { id: true },
    })

    return jsonOk({ signatureMediaAssetId: mediaId }, 200)
  } catch (e: unknown) {
    console.error('POST /api/v1/pro/media/[id]/signature error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Internal server error')
  }
}

// DELETE — clear the Signature, but only when THIS media is the current one, so
// a "remove" tap on one tile can never wipe a Signature set on another. A no-op
// still returns 200, keeping the control idempotent.
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    await prisma.professionalProfile.updateMany({
      where: { id: professionalId, signatureMediaAssetId: mediaId },
      data: { signatureMediaAssetId: null },
    })

    return jsonOk({ signatureMediaAssetId: null }, 200)
  } catch (e: unknown) {
    console.error('DELETE /api/v1/pro/media/[id]/signature error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Internal server error')
  }
}
