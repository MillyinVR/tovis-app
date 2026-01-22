// app/api/client/reviews/[id]/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireClient, pickString, jsonFail, jsonOk } from '@/app/api/_utils'

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
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId } = auth

    const { id } = await context.params
    const reviewId = pickString(id)
    if (!reviewId) return jsonFail(400, 'Missing review id.')

    const existing = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true },
    })

    if (!existing) return jsonFail(404, 'Review not found.')
    if (existing.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const body = (await req.json().catch(() => ({}))) as UpdateReviewBody

    const ratingParsed = parseRating(body.rating)
    if (ratingParsed === 'invalid') return jsonFail(400, 'Rating must be an integer 1–5.')

    const headlineNorm = normalizeText(body.headline, HEADLINE_MAX)
    if ('invalid' in headlineNorm) return jsonFail(400, `Headline: ${headlineNorm.invalid}`)

    const bodyNorm = normalizeText(body.body, BODY_MAX)
    if ('invalid' in bodyNorm) return jsonFail(400, `Body: ${bodyNorm.invalid}`)

    const hasAnyChange =
      ratingParsed !== undefined || !('unset' in headlineNorm) || !('unset' in bodyNorm)

    if (!hasAnyChange) {
      const current = await prisma.review.findUnique({
        where: { id: reviewId },
        include: { mediaAssets: true },
      })
      return jsonOk({ review: current })
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

    return jsonOk({ review: updated })
  } catch (e) {
    console.error('PATCH /api/client/reviews/[id] error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId } = auth

    const { id } = await context.params
    const reviewId = pickString(id)
    if (!reviewId) return jsonFail(400, 'Missing review id.')

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true },
    })

    if (!review) return jsonFail(404, 'Review not found.')
    if (review.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const lockedCount = await prisma.mediaAsset.count({
      where: {
        reviewId: review.id,
        OR: [{ isFeaturedInPortfolio: true }, { isEligibleForLooks: true }],
      },
    })

    if (lockedCount > 0) {
      return jsonFail(
        409,
        `You can’t delete this review because ${lockedCount} media item(s) are used in portfolio/Looks.`,
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.mediaAsset.deleteMany({ where: { reviewId: review.id } })
      await tx.review.delete({ where: { id: review.id } })
    })

    return jsonOk({})
  } catch (e) {
    console.error('DELETE /api/client/reviews/[id] error', e)
    return jsonFail(500, 'Internal server error')
  }
}
