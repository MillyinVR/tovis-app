// app/api/v1/media/url/route.ts
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { pickString } from '@/lib/pick'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { isPubliclyViewableMediaAsset } from '@/lib/media/mediaVisibility'
import type { MediaSignedUrlDTO } from '@/lib/dto/media'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const mediaId = pickString(searchParams.get('id'))
    if (!mediaId) return jsonFail(400, 'Missing id.')

    const media = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        visibility: true,
        professionalId: true,
        // The public-surface gate below is not `visibility === PUBLIC` alone —
        // see lib/media/mediaVisibility.ts.
        reviewId: true,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,

        // ✅ single source of truth inputs
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,

        // fallback only (renderer will only use if http(s))
        url: true,
        thumbUrl: true,
      },
    })

    if (!media) return jsonFail(404, 'Not found.')

    // ✅ Public media can be fetched without auth.
    // 🔴 A pro's own upload in the public bucket keeps visibility PUBLIC after
    // they retract it, so this asks the surface question (flags / reviewId), not
    // just the column — otherwise un-featuring a photo would leave it resolvable
    // by id to anonymous callers.
    if (
      isPubliclyViewableMediaAsset({
        visibility: media.visibility,
        isFeaturedInPortfolio: media.isFeaturedInPortfolio,
        isEligibleForLooks: media.isEligibleForLooks,
        reviewId: media.reviewId,
      })
    ) {
      const { renderUrl } = await renderMediaUrls({
        storageBucket: media.storageBucket,
        storagePath: media.storagePath,
        thumbBucket: media.thumbBucket,
        thumbPath: media.thumbPath,
        url: media.url,
        thumbUrl: media.thumbUrl,
      })

      if (!renderUrl) return jsonFail(500, 'Media is missing renderable URL.')
      return jsonOk({ url: renderUrl } satisfies MediaSignedUrlDTO)
    }

    // ✅ Anything non-public requires auth
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res
    const user = auth.user

    const isOwnerPro = user.role === 'PRO' && user.professionalProfile?.id === media.professionalId
    if (!isOwnerPro) return jsonFail(403, 'Forbidden.')

    const { renderUrl } = await renderMediaUrls({
      storageBucket: media.storageBucket,
      storagePath: media.storagePath,
      thumbBucket: media.thumbBucket,
      thumbPath: media.thumbPath,
      url: media.url,
      thumbUrl: media.thumbUrl,
    })

    if (!renderUrl) return jsonFail(500, 'Media is missing renderable URL.')
    return jsonOk({ url: renderUrl } satisfies MediaSignedUrlDTO)
  } catch (e) {
    console.error('GET /api/v1/media/url error', e)
    return jsonFail(500, 'Internal server error')
  }
}