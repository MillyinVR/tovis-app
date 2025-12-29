// app/api/client/bookings/[id]/review/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type MediaType = 'IMAGE' | 'VIDEO'

type CreateReviewBody = {
  rating?: unknown
  headline?: unknown
  body?: unknown
  media?: unknown // array of { url, thumbUrl?, mediaType }
}

type IncomingMediaItem = {
  url: string
  thumbUrl?: string | null
  mediaType: MediaType
}

type Ctx = {
  // ✅ MUST match folder name: app/api/client/bookings/[id]/...
  params: Promise<{ id: string }>
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

function parseRating(x: unknown): number | null {
  const n =
    typeof x === 'number'
      ? x
      : typeof x === 'string'
        ? Number.parseInt(x, 10)
        : Number.NaN

  if (!Number.isFinite(n) || n < 1 || n > 5) return null
  return n
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
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
    if (!rating) {
      return NextResponse.json({ error: 'Rating must be an integer from 1–5.' }, { status: 400 })
    }

    const headline = typeof body.headline === 'string' ? body.headline.trim() : null
    const reviewBody = typeof body.body === 'string' ? body.body.trim() : null
    const mediaItems = parseMedia(body.media)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, clientId: true, professionalId: true, finishedAt: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })

    if (booking.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    // If you ONLY want reviews after completion, uncomment this:
    // if (!booking.finishedAt) {
    //   return NextResponse.json({ error: 'You can review after the service is completed.' }, { status: 409 })
    // }

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

    const created = await prisma.review.create({
      data: {
        clientId: user.clientProfile.id,
        professionalId: booking.professionalId,
        bookingId: booking.id,
        rating,
        headline: headline || null,
        body: reviewBody || null,
        mediaAssets: mediaItems.length
          ? {
              create: mediaItems.map((m) => ({
                professionalId: booking.professionalId,
                bookingId: booking.id,
                url: m.url,
                thumbUrl: m.thumbUrl ?? null,
                mediaType: m.mediaType,
                visibility: 'PRIVATE',
                uploadedByUserId: user.id,
                uploadedByRole: 'CLIENT',
                isFeaturedInPortfolio: false,
                isEligibleForLooks: false,
              })),
            }
          : undefined,
      },
      include: { mediaAssets: true },
    })

    return NextResponse.json({ ok: true, review: created }, { status: 201 })
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/review error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
