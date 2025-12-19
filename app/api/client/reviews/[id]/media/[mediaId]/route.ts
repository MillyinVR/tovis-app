// app/api/client/reviews/[id]/media/[mediaId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: { id: string; mediaId: string }
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const reviewId = pickString(context.params?.id)
    const mediaId = pickString(context.params?.mediaId)

    if (!reviewId || !mediaId) {
      return NextResponse.json({ error: 'Missing id or mediaId.' }, { status: 400 })
    }

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

    // Fetch media directly, then validate constraints.
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

    if (!media) return NextResponse.json({ error: 'Media not found.' }, { status: 404 })

    // Must belong to this review + this user + client upload
    if (
      media.reviewId !== reviewId ||
      media.uploadedByUserId !== user.id ||
      media.uploadedByRole !== 'CLIENT'
    ) {
      return NextResponse.json({ error: 'Media not found.' }, { status: 404 })
    }

    // Business rule: can't delete if pro has promoted it
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
