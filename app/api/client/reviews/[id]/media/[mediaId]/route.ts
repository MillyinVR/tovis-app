// app/api/client/reviews/[id]/media/[mediaId]/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireClient, pickString, jsonFail, jsonOk } from '@/app/api/_utils'
import { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string; mediaId: string }>
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { user, clientId } = auth

    const raw = await params
    const reviewId = pickString(raw?.id)
    const mediaId = pickString(raw?.mediaId)

    if (!reviewId || !mediaId) return jsonFail(400, 'Missing id or mediaId.')

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true },
    })

    if (!review) return jsonFail(404, 'Review not found.')
    if (review.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const media = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        reviewId: true,
        uploadedByUserId: true,
        uploadedByRole: true,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
      },
    })

    // 404 to avoid leaking existence
    if (!media) return jsonFail(404, 'Media not found.')

    if (
      media.reviewId !== reviewId ||
      media.uploadedByUserId !== user.id ||
      media.uploadedByRole !== Role.CLIENT
    ) {
      return jsonFail(404, 'Media not found.')
    }

    if (media.isFeaturedInPortfolio || media.isEligibleForLooks) {
      return jsonFail(409, 'This media is in the professional’s portfolio/Looks and cannot be removed.')
    }

    await prisma.mediaAsset.delete({ where: { id: mediaId } })

    return jsonOk({})
  } catch (e) {
    console.error('DELETE /api/client/reviews/[id]/media/[mediaId] error', e)
    return jsonFail(500, 'Internal server error')
  }
}