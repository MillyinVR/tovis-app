// app/api/client/reviews/[id]/media/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { MediaType, MediaVisibility, Role } from '@prisma/client'
import { requireClient, pickString, jsonFail, safeUrl, resolveStoragePointers } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type AddReviewMediaBody = { media?: unknown }

type IncomingMediaItem = {
  url: string
  thumbUrl?: string | null
  mediaType: MediaType
  storageBucket?: string | null
  storagePath?: string | null
  thumbBucket?: string | null
  thumbPath?: string | null
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

    items.push({
      url,
      thumbUrl,
      mediaType,
      storageBucket: pickString(obj.storageBucket) ?? null,
      storagePath: pickString(obj.storagePath) ?? null,
      thumbBucket: pickString(obj.thumbBucket) ?? null,
      thumbPath: pickString(obj.thumbPath) ?? null,
    })
  }

  return items
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { user, clientId } = auth

    const { id } = await context.params
    const reviewId = pickString(id)
    if (!reviewId) return jsonFail(400, 'Missing review id.')

    const body = (await req.json().catch(() => ({}))) as AddReviewMediaBody
    const mediaItems = parseMedia(body.media)
    if (!mediaItems.length) return jsonFail(400, 'No valid media provided.')

    const resolved = mediaItems.map((m) => {
      const ptrs = resolveStoragePointers(m)
      if (!ptrs) throw new Error('Media must include storageBucket/storagePath or a parsable Supabase Storage URL.')
      return { ...m, ...ptrs }
    })

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true, professionalId: true, bookingId: true },
    })

    if (!review) return jsonFail(404, 'Review not found.')
    if (review.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    if (!review.bookingId) {
      return jsonFail(
        409,
        'This review is not linked to a booking. Media must be attached to a booking to appear in aftercare.',
      )
    }

    const created = await prisma.$transaction(
      resolved.map((m) =>
        prisma.mediaAsset.create({
          data: {
            professionalId: review.professionalId,
            bookingId: review.bookingId!,
            reviewId: review.id,

            url: m.url,
            thumbUrl: m.thumbUrl ?? null,
            mediaType: m.mediaType,

            visibility: 'PRIVATE' as MediaVisibility,
            uploadedByUserId: user.id,
            uploadedByRole: 'CLIENT' as Role,

            isFeaturedInPortfolio: false,
            isEligibleForLooks: false,
            reviewLocked: true,

            storageBucket: m.storageBucket!,
            storagePath: m.storagePath!,
            thumbBucket: m.thumbBucket ?? null,
            thumbPath: m.thumbPath ?? null,
          },
          select: {
            id: true,
            url: true,
            thumbUrl: true,
            mediaType: true,
            createdAt: true,
            isFeaturedInPortfolio: true,
            isEligibleForLooks: true,
            storageBucket: true,
            storagePath: true,
            thumbBucket: true,
            thumbPath: true,
          },
        }),
      ),
    )

    const updated = await prisma.review.findUnique({
      where: { id: reviewId },
      include: { mediaAssets: true },
    })

    return NextResponse.json({ ok: true, createdCount: created.length, created, review: updated }, { status: 201 })
  } catch (e: any) {
    console.error('POST /api/client/reviews/[id]/media error', e)
    const msg = typeof e?.message === 'string' && e.message.includes('Media') ? e.message : 'Internal server error'
    return jsonFail(500, msg)
  }
}
