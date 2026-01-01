// app/api/client/reviews/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type UpdateReviewBody = {
  rating?: unknown
  headline?: unknown
  body?: unknown
}

const HEADLINE_MAX = 120
const BODY_MAX = 4000

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseRating(x: unknown): number | undefined | 'invalid' {
  if (x === undefined) return undefined
  const n =
    typeof x === 'number'
      ? x
      : typeof x === 'string'
        ? Number(x.trim())
        : Number.NaN

  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 5) return 'invalid'
  return n
}

function normalizeText(
  value: unknown,
  maxLen: number,
): { value: string | null } | { invalid: string } | { unset: true } {
  if (value === undefined) return { unset: true }
  if (value === null) return { value: null }
  if (typeof value !== 'string') return { invalid: 'Must be a string.' }

  const trimmed = value.trim()
  if (!trimmed) return { value: null }
  if (trimmed.length > maxLen) return { invalid: `Must be <= ${maxLen} characters.` }
  return { value: trimmed }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const reviewId = pickString(id)
    if (!reviewId) return NextResponse.json({ error: 'Missing review id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const existing = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true },
    })

    if (!existing) return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
    if (existing.clientId !== user.clientProfile.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as UpdateReviewBody

    const ratingParsed = parseRating(body.rating)
    if (ratingParsed === 'invalid') {
      return NextResponse.json({ error: 'Rating must be an integer 1–5.' }, { status: 400 })
    }

    const headlineNorm = normalizeText(body.headline, HEADLINE_MAX)
    if ('invalid' in headlineNorm) {
      return NextResponse.json({ error: `Headline: ${headlineNorm.invalid}` }, { status: 400 })
    }

    const bodyNorm = normalizeText(body.body, BODY_MAX)
    if ('invalid' in bodyNorm) {
      return NextResponse.json({ error: `Body: ${bodyNorm.invalid}` }, { status: 400 })
    }

    const hasAnyChange =
      ratingParsed !== undefined || !('unset' in headlineNorm) || !('unset' in bodyNorm)

    if (!hasAnyChange) {
      const current = await prisma.review.findUnique({
        where: { id: reviewId },
        include: { mediaAssets: true },
      })
      return NextResponse.json({ ok: true, review: current }, { status: 200 })
    }

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(ratingParsed !== undefined ? { rating: ratingParsed } : {}),
        ...(!('unset' in headlineNorm) ? { headline: headlineNorm.value } : {}),
        ...(!('unset' in bodyNorm) ? { body: bodyNorm.value } : {}),
      },
      include: { mediaAssets: true },
    })

    return NextResponse.json({ ok: true, review: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/client/reviews/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const reviewId = pickString(id)
    if (!reviewId) return NextResponse.json({ error: 'Missing review id.' }, { status: 400 })

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

    // 🔒 Server-side lock enforcement (don’t trust the UI)
    const lockedCount = await prisma.mediaAsset.count({
      where: {
        reviewId: review.id,
        OR: [{ isFeaturedInPortfolio: true }, { isEligibleForLooks: true }],
      },
    })

    if (lockedCount > 0) {
      return NextResponse.json(
        { error: `You can’t delete this review because ${lockedCount} media item(s) are used in portfolio/Looks.` },
        { status: 409 },
      )
    }

    await prisma.$transaction(async (tx) => {
      // If the review owns media, delete it. Don’t “orphan” junk records.
      await tx.mediaAsset.deleteMany({
        where: { reviewId: review.id },
      })

      await tx.review.delete({ where: { id: review.id } })
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/client/reviews/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
