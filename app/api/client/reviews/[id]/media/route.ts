// app/api/client/reviews/[id]/media/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type MediaType = 'IMAGE' | 'VIDEO'

type AddReviewMediaBody = {
  media?: unknown
}

type IncomingMediaItem = {
  url: string
  thumbUrl?: string | null
  mediaType: MediaType
}

function isMediaType(x: unknown): x is MediaType {
  return x === 'IMAGE' || x === 'VIDEO'
}

function parseMedia(bodyMedia: unknown): IncomingMediaItem[] {
  if (!Array.isArray(bodyMedia)) return []
  const items: IncomingMediaItem[] = []

  for (const raw of bodyMedia) {
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>

    const url = typeof obj.url === 'string' ? obj.url.trim() : ''
    const thumbUrl = typeof obj.thumbUrl === 'string' ? obj.thumbUrl.trim() : null
    const mediaType: MediaType = isMediaType(obj.mediaType) ? obj.mediaType : 'IMAGE'

    if (!url) continue
    items.push({ url, thumbUrl, mediaType })
  }

  return items
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const reviewId = params.id

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as AddReviewMediaBody
    const mediaItems = parseMedia(body.media)
    if (!mediaItems.length) return NextResponse.json({ error: 'No media provided.' }, { status: 400 })

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true, professionalId: true, bookingId: true },
    })

    if (!review) return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
    if (review.clientId !== user.clientProfile.id) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    if (!review.bookingId) {
      return NextResponse.json(
        {
          error:
            'This review is not linked to a booking. Media must be attached to a booking to appear in aftercare.',
        },
        { status: 409 },
      )
    }

    const created = await prisma.mediaAsset.createMany({
      data: mediaItems.map((m) => ({
        professionalId: review.professionalId,
        bookingId: review.bookingId,
        reviewId: review.id,
        url: m.url,
        thumbUrl: m.thumbUrl ?? null,
        mediaType: m.mediaType,
        visibility: 'PRIVATE',
        uploadedByUserId: user.id,
        uploadedByRole: 'CLIENT',
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
      })),
      skipDuplicates: true,
    })

    const updated = await prisma.review.findUnique({
      where: { id: reviewId },
      include: { mediaAssets: true },
    })

    return NextResponse.json({ ok: true, createdCount: created.count, review: updated }, { status: 201 })
  } catch (e) {
    console.error('POST /api/client/reviews/[id]/media error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
