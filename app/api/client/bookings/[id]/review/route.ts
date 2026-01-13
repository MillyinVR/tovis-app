// app/api/client/bookings/[id]/review/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import type { MediaType, MediaVisibility, Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type CreateReviewBody = {
  rating?: unknown
  headline?: unknown
  body?: unknown
  media?: unknown
  attachedMediaIds?: unknown
}

type IncomingMediaItem = {
  url: string
  thumbUrl?: string | null
  mediaType: MediaType

  // preferred: explicit storage pointers
  storageBucket?: string | null
  storagePath?: string | null
  thumbBucket?: string | null
  thumbPath?: string | null
}

type Ctx = { params: Promise<{ id: string }> }

const URL_MAX = 2048

function pickString(v: unknown): string | null {
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

/**
 * Extract bucket/path from Supabase Storage URLs (public or signed).
 * Supports:
 *  - /storage/v1/object/public/<bucket>/<path>
 *  - /storage/v1/object/sign/<bucket>/<path>
 *  - /storage/v1/object/<bucket>/<path>   (some setups)
 */
function parseSupabaseStoragePointer(urlStr: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(urlStr)
    const parts = u.pathname.split('/').filter(Boolean)

    const idx = parts.findIndex((p) => p === 'storage')
    if (idx === -1) return null

    // expected: storage / v1 / object / (public|sign|...) / bucket / ...path
    const v1 = parts[idx + 1]
    const object = parts[idx + 2]
    if (v1 !== 'v1' || object !== 'object') return null

    const mode = parts[idx + 3] // public | sign | bucket (depending)
    const bucket = parts[idx + 4]
    const restStart = idx + 5

    if (!mode || !bucket || restStart > parts.length) {
      // maybe it's /storage/v1/object/<bucket>/<path>
      const bucketAlt = parts[idx + 3]
      const restAltStart = idx + 4
      if (!bucketAlt || restAltStart > parts.length) return null
      return { bucket: bucketAlt, path: parts.slice(restAltStart).join('/') }
    }

    if (mode === 'public' || mode === 'sign') {
      const path = parts.slice(restStart).join('/')
      if (!path) return null
      return { bucket, path }
    }

    // fallback: /storage/v1/object/<bucket>/<path> (mode is actually bucket)
    return { bucket: mode, path: parts.slice(idx + 4).join('/') }
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

    const storageBucket = pickString(obj.storageBucket) ?? null
    const storagePath = pickString(obj.storagePath) ?? null
    const thumbBucket = pickString(obj.thumbBucket) ?? null
    const thumbPath = pickString(obj.thumbPath) ?? null

    items.push({ url, thumbUrl, mediaType, storageBucket, storagePath, thumbBucket, thumbPath })
  }

  return items
}

function parseRating(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number.parseInt(x, 10) : Number.NaN
  if (!Number.isFinite(n) || n < 1 || n > 5) return null
  return n
}

function parseIdArray(x: unknown, max: number): string[] {
  if (!Array.isArray(x)) return []
  const out: string[] = []
  for (const v of x) {
    const s = pickString(v)
    if (!s) continue
    out.push(s)
    if (out.length >= max) break
  }
  return Array.from(new Set(out))
}

function resolveStoragePointers(m: IncomingMediaItem): {
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
} | null {
  // If client provided explicit pointers, trust them.
  if (m.storageBucket && m.storagePath) {
    return {
      storageBucket: m.storageBucket,
      storagePath: m.storagePath,
      thumbBucket: m.thumbBucket ?? null,
      thumbPath: m.thumbPath ?? null,
    }
  }

  // Otherwise try to extract from URL(s)
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

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as CreateReviewBody

    const rating = parseRating(body.rating)
    if (!rating) return NextResponse.json({ error: 'Rating must be an integer from 1–5.' }, { status: 400 })

    const headline = typeof body.headline === 'string' ? body.headline.trim() : null
    const reviewBody = typeof body.body === 'string' ? body.body.trim() : null

    const clientMediaItems = parseMedia(body.media)
    const attachedMediaIds = parseIdArray(body.attachedMediaIds, 2)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, clientId: true, professionalId: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== user.clientProfile.id) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    const existing = await prisma.review.findFirst({
      where: { bookingId: booking.id, clientId: user.clientProfile.id },
      select: { id: true },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Review already exists for this booking.', reviewId: existing.id },
        { status: 409 },
      )
    }

    // Validate storage pointers before we start the transaction (fast fail)
    const resolvedClientMedia = clientMediaItems.map((m) => {
      const ptrs = resolveStoragePointers(m)
      if (!ptrs) {
        throw new Error(
          'Media items must include storageBucket/storagePath or a Supabase Storage URL that can be parsed.',
        )
      }
      return { ...m, ...ptrs }
    })

    const created = await prisma.$transaction(async (tx) => {
      const attachables = attachedMediaIds.length
        ? await tx.mediaAsset.findMany({
            where: {
              id: { in: attachedMediaIds },
              bookingId: booking.id,
              professionalId: booking.professionalId,
              uploadedByRole: 'PRO',
              reviewId: null,
            },
            select: { id: true },
          })
        : []

      if (attachedMediaIds.length && attachables.length !== attachedMediaIds.length) {
        return { ok: false as const, status: 400, error: 'One or more selected images are not available to attach.' }
      }

      const review = await tx.review.create({
        data: {
          clientId: user.clientProfile!.id,
          professionalId: booking.professionalId,
          bookingId: booking.id,
          rating,
          headline: headline || null,
          body: reviewBody || null,
        },
        select: { id: true },
      })

      if (attachables.length) {
        await tx.mediaAsset.updateMany({
          where: { id: { in: attachables.map((a) => a.id) } },
          data: {
            reviewId: review.id,
            visibility: 'PRIVATE' as MediaVisibility,
            isEligibleForLooks: false,
            isFeaturedInPortfolio: false,
            reviewLocked: true,
          },
        })
      }

      if (resolvedClientMedia.length) {
        await tx.mediaAsset.createMany({
          data: resolvedClientMedia.map((m) => ({
            professionalId: booking.professionalId,
            bookingId: booking.id,
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
          })),
        })
      }

      const full = await tx.review.findUnique({
        where: { id: review.id },
        include: {
          mediaAssets: {
            orderBy: { createdAt: 'desc' },
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
          },
        },
      })

      return { ok: true as const, review: full }
    })

    if (!created.ok) {
      return NextResponse.json({ error: created.error }, { status: created.status })
    }

    return NextResponse.json({ ok: true, review: created.review }, { status: 201 })
  } catch (e: any) {
    console.error('POST /api/client/bookings/[id]/review error', e)
    const msg =
      typeof e?.message === 'string' && e.message.includes('storageBucket')
        ? e.message
        : 'Internal server error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
