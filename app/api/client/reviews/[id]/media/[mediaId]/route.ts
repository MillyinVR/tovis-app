// app/api/client/reviews/[id]/media/[mediaId]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: { id: string; mediaId: string } }) {
  try {
    const reviewId = params.id
    const mediaId = params.mediaId

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true },
    })

    if (!review) return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
    if (review.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const media = await prisma.mediaAsset.findFirst({
      where: {
        id: mediaId,
        reviewId,
        uploadedByUserId: user.id,
        uploadedByRole: 'CLIENT',
      },
      select: { id: true, isFeaturedInPortfolio: true, isEligibleForLooks: true },
    })

    if (!media) return NextResponse.json({ error: 'Media not found.' }, { status: 404 })

    if (media.isFeaturedInPortfolio || media.isEligibleForLooks) {
      return NextResponse.json(
        { error: 'This media is in the professional’s portfolio/Looks and cannot be removed.' },
        { status: 409 },
      )
    }

    await prisma.mediaAsset.delete({ where: { id: mediaId } })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/client/reviews/[id]/media/[mediaId] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
