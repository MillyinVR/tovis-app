// app/api/client/reviews/[id]/media/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { MediaType, MediaVisibility, Role } from '@prisma/client'

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

function parseSupabaseStoragePointer(urlStr: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(urlStr)
    const parts = u.pathname.split('/').filter(Boolean)

    const idx = parts.findIndex((p) => p === 'storage')
    if (idx === -1) return null
    const v1 = parts[idx + 1]
    const object = parts[idx + 2]
    if (v1 !== 'v1' || object !== 'object') return null

    const mode = parts[idx + 3]
    const bucket = parts[idx + 4]
    const restStart = idx + 5

    if (mode && bucket && (mode === 'public' || mode === 'sign')) {
      const path = parts.slice(restStart).join('/')
      if (!path) return null
      return { bucket, path }
    }

    // fallback: /storage/v1/object/<bucket>/<path>
    const bucketAlt = parts[idx + 3]
    const pathAlt = parts.slice(idx + 4).join('/')
    if (!bucketAlt || !pathAlt) return null
    return { bucket: bucketAlt, path: pathAlt }
  } catch {
    return null
  }
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

function resolveStoragePointers(m: IncomingMediaItem) {
  if (m.storageBucket && m.storagePath) {
    return {
      storageBucket: m.storageBucket,
      storagePath: m.storagePath,
      thumbBucket: m.thumbBucket ?? null,
      thumbPath: m.thumbPath ?? null,
    }
  }

  const ptr = parseSupabaseStoragePointer(m.url)
  if (!ptr) return null
  const thumbPtr = m.thumbUrl ? parseSupabaseStoragePointer(m.thumbUrl) : null

  return {
    storageBucket: ptr.bucket,
    storagePath: ptr.path,
    thumbBucket: thumbPtr?.bucket ?? null,
    thumbPath: thumbPtr?.path ?? null,
  }
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

    const resolved = mediaItems.map((m) => {
      const ptrs = resolveStoragePointers(m)
      if (!ptrs) {
        throw new Error('Media must include storageBucket/storagePath or a parsable Supabase Storage URL.')
      }
      return { ...m, ...ptrs }
    })

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
    const msg =
      typeof e?.message === 'string' && e.message.includes('storage')
        ? e.message
        : 'Internal server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
