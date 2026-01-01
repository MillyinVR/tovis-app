// app/api/pro/media/[id]/portfolio/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function computeVisibility(nextFeatured: boolean, isEligibleForLooks: boolean) {
  // PUBLIC if it belongs in portfolio OR it’s eligible for Looks
  return nextFeatured || isEligibleForLooks ? 'PUBLIC' : 'PRIVATE'
}

async function guardProOwnerAndReviewMedia(id: string) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    return { ok: false as const, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const proId = user.professionalProfile.id

  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: {
      id: true,
      professionalId: true,
      reviewId: true, // 🔒 must exist to allow portfolio promotion
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      visibility: true,
    },
  })

  if (!media) {
    return { ok: false as const, res: NextResponse.json({ error: 'Media not found' }, { status: 404 }) }
  }
  if (media.professionalId !== proId) {
    return { ok: false as const, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  // 🔒 Critical rule: only review-attached media can be featured in portfolio
  if (!media.reviewId) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: 'Only media attached to a review can be added to portfolio.' },
        { status: 409 },
      ),
    }
  }

  return { ok: true as const, proId, media }
}

export async function POST(_req: NextRequest, props: Props) {
  try {
    const { id: rawId } = await props.params
    const id = pickString(rawId)
    if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

    const guard = await guardProOwnerAndReviewMedia(id)
    if (!guard.ok) return guard.res

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        isFeaturedInPortfolio: true,
        visibility: computeVisibility(true, guard.media.isEligibleForLooks),
      },
      select: { id: true, isFeaturedInPortfolio: true, isEligibleForLooks: true, visibility: true },
    })

    return NextResponse.json({ ok: true, media: updated }, { status: 200 })
  } catch (e) {
    console.error('POST /api/pro/media/[id]/portfolio error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: Props) {
  try {
    const { id: rawId } = await props.params
    const id = pickString(rawId)
    if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

    const guard = await guardProOwnerAndReviewMedia(id)
    if (!guard.ok) return guard.res

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        isFeaturedInPortfolio: false,
        visibility: computeVisibility(false, guard.media.isEligibleForLooks),
      },
      select: { id: true, isFeaturedInPortfolio: true, isEligibleForLooks: true, visibility: true },
    })

    return NextResponse.json({ ok: true, media: updated }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/pro/media/[id]/portfolio error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
