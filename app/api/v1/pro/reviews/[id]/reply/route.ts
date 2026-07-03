// app/api/v1/pro/reviews/[id]/reply/route.ts
//
// A pro's single public response to a review. PUT upserts (edit overwrites),
// DELETE clears. Ownership is enforced atomically in the updateMany where
// clause; a foreign review id reads as 404, never 403 (no existence leak).
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import type {
  ProReviewReplyDeleteResponseDTO,
  ProReviewReplyUpsertResponseDTO,
} from '@/lib/dto/proReviewReply'

export const dynamic = 'force-dynamic'

const MAX_REPLY_LENGTH = 1000

async function readReplyBody(req: Request): Promise<string | null> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType && !contentType.includes('application/json')) return null

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return null
  }

  if (!isRecord(raw) || typeof raw.body !== 'string') return null

  const trimmed = raw.body.trim()
  if (!trimmed || trimmed.length > MAX_REPLY_LENGTH) return null

  return trimmed
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id } = await ctx.params
    if (!id) return jsonFail(404, 'Review not found.')

    const body = await readReplyBody(req)
    if (!body) {
      return jsonFail(
        400,
        `Reply body must be 1–${MAX_REPLY_LENGTH} characters.`,
      )
    }

    const repliedAt = new Date()

    const updated = await prisma.review.updateMany({
      where: { id, professionalId: auth.professionalId },
      data: { proReplyBody: body, proReplyAt: repliedAt },
    })

    if (updated.count === 0) return jsonFail(404, 'Review not found.')

    const response: ProReviewReplyUpsertResponseDTO = {
      reviewId: id,
      reply: {
        body,
        repliedAtISO: repliedAt.toISOString(),
      },
    }

    return jsonOk(response)
  } catch (error: unknown) {
    console.error('PUT /api/v1/pro/reviews/[id]/reply error', error)
    return jsonFail(500, 'Failed to save reply.')
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id } = await ctx.params
    if (!id) return jsonFail(404, 'Review not found.')

    const updated = await prisma.review.updateMany({
      where: { id, professionalId: auth.professionalId },
      data: { proReplyBody: null, proReplyAt: null },
    })

    if (updated.count === 0) return jsonFail(404, 'Review not found.')

    const response: ProReviewReplyDeleteResponseDTO = {
      reviewId: id,
      deleted: true,
    }

    return jsonOk(response)
  } catch (error: unknown) {
    console.error('DELETE /api/v1/pro/reviews/[id]/reply error', error)
    return jsonFail(500, 'Failed to remove reply.')
  }
}
