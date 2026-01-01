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
  media?: unknown // array of { url, thumbUrl?, mediaType } (client-provided)
  attachedMediaIds?: unknown // array of booking media IDs chosen by client
}

type IncomingMediaItem = {
  url: string
  thumbUrl?: string | null
  mediaType: MediaType
}

type Ctx = {
  params: Promise<{ id: string }>
}

function isMediaType(x: unknown): x is MediaType {
  return x === 'IMAGE' || x === 'VIDEO'
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
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

    // client-uploaded media (URL placeholder)
    const clientMediaItems = parseMedia(body.media)

    // client-selected booking media to attach (max 2 as per your spec)
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
      return NextResponse.json({ error: 'Review already exists for this booking.', reviewId: existing.id }, { status: 409 })
    }

    const created = await prisma.$transaction(async (tx) => {
      // Validate attachables belong to this booking, are pro-uploaded, and not already in a review
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

      // Attach booking media to the review (these were uploaded by the pro)
      if (attachables.length) {
        await tx.mediaAsset.updateMany({
          where: { id: { in: attachables.map((a) => a.id) } },
          data: {
            reviewId: review.id,
            // keep private forever:
            visibility: 'PRIVATE',
            isEligibleForLooks: false,
            isFeaturedInPortfolio: false,
          },
        })
      }

      // Create client-uploaded media directly on the review
      if (clientMediaItems.length) {
        await tx.mediaAsset.createMany({
          data: clientMediaItems.map((m) => ({
            professionalId: booking.professionalId,
            bookingId: booking.id,
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
        })
      }

      const full = await tx.review.findUnique({
        where: { id: review.id },
        include: {
          mediaAssets: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, url: true, thumbUrl: true, mediaType: true, createdAt: true, isFeaturedInPortfolio: true, isEligibleForLooks: true },
          },
        },
      })

      return { ok: true as const, review: full }
    })

    if (!created.ok) {
      return NextResponse.json({ error: created.error }, { status: created.status })
    }

    return NextResponse.json({ ok: true, review: created.review }, { status: 201 })
  } catch (e) {
    console.error('POST /api/client/bookings/[id]/review error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
