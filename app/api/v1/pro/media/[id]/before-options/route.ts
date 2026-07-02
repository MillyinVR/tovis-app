// app/api/v1/pro/media/[id]/before-options/route.ts
// Candidate "before" photos a pro can pair with a featured "after". Returns the
// other IMAGE assets from the after's booking (render-safe), so the portfolio
// before/after picker can offer a choice beyond the default auto-pairing.
import { MediaPhase, MediaType } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const MAX_OPTIONS = 24

const PHASE_RANK: Record<MediaPhase, number> = {
  [MediaPhase.BEFORE]: 0,
  [MediaPhase.OTHER]: 1,
  [MediaPhase.AFTER]: 2,
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    const after = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        professionalId: true,
        bookingId: true,
        mediaType: true,
      },
    })

    if (!after) return jsonFail(404, 'Media not found.')
    if (after.professionalId !== professionalId) {
      return jsonFail(403, 'Forbidden.')
    }

    // Only an image "after" from a booking can have a before to pair with.
    if (after.mediaType !== MediaType.IMAGE || !after.bookingId) {
      return jsonOk({ options: [] }, 200)
    }

    const candidates = await prisma.mediaAsset.findMany({
      where: {
        bookingId: after.bookingId,
        professionalId,
        mediaType: MediaType.IMAGE,
        id: { not: after.id },
      },
      select: {
        id: true,
        phase: true,
        createdAt: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
      },
      take: 80,
    })

    const sorted = candidates.sort((a, b) => {
      const rank = PHASE_RANK[a.phase] - PHASE_RANK[b.phase]
      if (rank !== 0) return rank
      return a.createdAt.getTime() - b.createdAt.getTime()
    })

    const options = (
      await Promise.all(
        sorted.slice(0, MAX_OPTIONS).map(async (row) => {
          const { renderUrl, renderThumbUrl } = await renderMediaUrls(row)
          const thumbUrl = pickString(renderThumbUrl) ?? pickString(renderUrl)
          if (!thumbUrl) return null
          return { id: row.id, thumbUrl, phase: row.phase }
        }),
      )
    ).filter((x): x is { id: string; thumbUrl: string; phase: MediaPhase } =>
      Boolean(x),
    )

    return jsonOk({ options }, 200)
  } catch (e: unknown) {
    console.error('GET /api/v1/pro/media/[id]/before-options error', {
      error: safeError(e),
    })
    return jsonFail(500, 'Internal server error')
  }
}
