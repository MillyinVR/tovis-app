// app/api/reviews/[id]/helpful/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function pickTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Login required.')

    if (user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return jsonFail(403, 'Only clients can mark reviews as helpful.')
    }

    const { id } = await ctx.params
    const reviewId = pickTrimmedString(id)
    if (!reviewId) return jsonFail(400, 'Missing review id.')

    const result = await prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        select: { id: true, helpfulCount: true },
      })
      if (!review) return { ok: false as const, status: 404, error: 'Review not found.' }

      const key = { reviewId_userId: { reviewId, userId: user.id } }

      const existing = await tx.reviewHelpful.findUnique({ where: key, select: { id: true } })
      if (existing) {
        return { ok: true as const, helpful: true, helpfulCount: review.helpfulCount ?? 0 }
      }

      await tx.reviewHelpful.create({
        data: { reviewId, userId: user.id },
        select: { id: true },
      })

      const updated = await tx.review.update({
        where: { id: reviewId },
        data: { helpfulCount: { increment: 1 } },
        select: { helpfulCount: true },
      })

      return { ok: true as const, helpful: true, helpfulCount: updated.helpfulCount ?? 0 }
    })

    if (!result.ok) return jsonFail(result.status, result.error)
    return jsonOk({ ok: true, helpful: result.helpful, helpfulCount: result.helpfulCount })
  } catch (e) {
    console.error('POST /api/reviews/[id]/helpful error', e)
    return jsonFail(500, 'Failed to mark helpful.')
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Login required.')

    if (user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return jsonFail(403, 'Only clients can unmark reviews as helpful.')
    }

    const { id } = await ctx.params
    const reviewId = pickTrimmedString(id)
    if (!reviewId) return jsonFail(400, 'Missing review id.')

    const result = await prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        select: { id: true, helpfulCount: true },
      })
      if (!review) return { ok: false as const, status: 404, error: 'Review not found.' }

      const key = { reviewId_userId: { reviewId, userId: user.id } }

      const existing = await tx.reviewHelpful.findUnique({ where: key, select: { id: true } })
      if (!existing) {
        return { ok: true as const, helpful: false, helpfulCount: review.helpfulCount ?? 0 }
      }

      await tx.reviewHelpful.delete({ where: key })

      // atomic + clamped
      await tx.review.updateMany({
        where: { id: reviewId, helpfulCount: { gt: 0 } },
        data: { helpfulCount: { decrement: 1 } },
      })

      const updated = await tx.review.findUnique({
        where: { id: reviewId },
        select: { helpfulCount: true },
      })

      return { ok: true as const, helpful: false, helpfulCount: updated?.helpfulCount ?? 0 }
    })

    if (!result.ok) return jsonFail(result.status, result.error)
    return jsonOk({ ok: true, helpful: result.helpful, helpfulCount: result.helpfulCount })
  } catch (e) {
    console.error('DELETE /api/reviews/[id]/helpful error', e)
    return jsonFail(500, 'Failed to unmark helpful.')
  }
}