// app/api/client/reviews/[id]/media/route.ts
import { NextRequest, NextResponse } from 'next/server'
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

const URL_MAX = 2048

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function safeUrl(raw: unknown): string | null {
  const s = pickString(raw)
  if (!s) return null
  if (s.length > URL_MAX) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
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

    const url = safeUrl(obj.url)
    if (!url) continue

    const thumbUrlRaw = obj.thumbUrl
    const thumbUrl = thumbUrlRaw == null || thumbUrlRaw === '' ? null : safeUrl(thumbUrlRaw)
    if (thumbUrlRaw && !thumbUrl) continue

    const mediaType: MediaType = isMediaType(obj.mediaType) ? obj.mediaType : 'IMAGE'

    items.push({ url, thumbUrl, mediaType })
  }

  return items
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const reviewId = pickString(id)
    if (!reviewId) return NextResponse.json({ error: 'Missing review id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as AddReviewMediaBody
    const mediaItems = parseMedia(body.media)
    if (!mediaItems.length) {
      return NextResponse.json({ error: 'No valid media provided.' }, { status: 400 })
    }

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true, professionalId: true, bookingId: true },
    })

    if (!review) return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
    if (review.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    if (!review.bookingId) {
      return NextResponse.json(
        { error: 'This review is not linked to a booking. Media must be attached to a booking to appear in aftercare.' },
        { status: 409 },
      )
    }

    // Create individually so we can return the created items (createMany can’t return IDs)
    const created = await prisma.$transaction(
      mediaItems.map((m) =>
        prisma.mediaAsset.create({
          data: {
            professionalId: review.professionalId,
            bookingId: review.bookingId!,
            reviewId: review.id,
            url: m.url,
            thumbUrl: m.thumbUrl ?? null,
            mediaType: m.mediaType,
            visibility: 'PRIVATE',
            uploadedByUserId: user.id,
            uploadedByRole: 'CLIENT',
            isFeaturedInPortfolio: false,
            isEligibleForLooks: false,
          },
          select: {
            id: true,
            url: true,
            thumbUrl: true,
            mediaType: true,
            createdAt: true,
            isFeaturedInPortfolio: true,
            isEligibleForLooks: true,
          },
        }),
      ),
    )

    const updated = await prisma.review.findUnique({
      where: { id: reviewId },
      include: { mediaAssets: true },
    })

    return NextResponse.json(
      { ok: true, createdCount: created.length, created, review: updated },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/client/reviews/[id]/media error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
