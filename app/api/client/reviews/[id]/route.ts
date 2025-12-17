// app/api/client/reviews/[id]/route.ts
import { NextResponse } from 'next/server'
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

function parseRating(x: unknown): number | undefined | 'invalid' {
  if (x === undefined) return undefined
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x.trim()) : NaN
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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const reviewId = params.id
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
    if (existing.clientId !== user.clientProfile.id) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    const body = (await req.json().catch(() => ({}))) as UpdateReviewBody

    const ratingParsed = parseRating(body.rating)
    if (ratingParsed === 'invalid') {
      return NextResponse.json({ error: 'Rating must be an integer 1–5.' }, { status: 400 })
    }

    const headlineNorm = normalizeText(body.headline, HEADLINE_MAX)
    if ('invalid' in headlineNorm) return NextResponse.json({ error: `Headline: ${headlineNorm.invalid}` }, { status: 400 })

    const reviewBodyNorm = normalizeText(body.body, BODY_MAX)
    if ('invalid' in reviewBodyNorm) return NextResponse.json({ error: `Body: ${reviewBodyNorm.invalid}` }, { status: 400 })

    const hasAnyChange =
      ratingParsed !== undefined || !('unset' in headlineNorm) || !('unset' in reviewBodyNorm)

    if (!hasAnyChange) {
      const current = await prisma.review.findUnique({ where: { id: reviewId }, include: { mediaAssets: true } })
      return NextResponse.json({ review: current }, { status: 200 })
    }

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(ratingParsed !== undefined ? { rating: ratingParsed } : {}),
        ...(!('unset' in headlineNorm) ? { headline: headlineNorm.value } : {}),
        ...(!('unset' in reviewBodyNorm) ? { body: reviewBodyNorm.value } : {}),
      },
      include: { mediaAssets: true },
    })

    return NextResponse.json({ review: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/client/reviews/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const reviewId = params.id
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
    if (review.clientId !== user.clientProfile.id) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    await prisma.$transaction(async (tx) => {
      await tx.mediaAsset.updateMany({
        where: { reviewId: review.id },
        data: {
          isFeaturedInPortfolio: false,
          isEligibleForLooks: false,
          visibility: 'PRIVATE',
          reviewId: null,
        },
      })

      await tx.review.delete({ where: { id: review.id } })
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/client/reviews/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
