// app/api/looks/[id]/comments/[commentId]/like/route.ts
import { Prisma, ModerationStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { buildLookPolicyInput, loadLookAccess } from '@/lib/looks/access'
import {
  canCommentOnLookPost,
  canViewLookPost,
} from '@/lib/looks/guards'
import { recomputeLookCommentLikeCount } from '@/lib/looks/counters'
import type { LooksCommentLikeResponseDto } from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

type CommentLikeContext = RouteContext<{ id: string; commentId: string }>

async function resolveTarget(ctx: CommentLikeContext) {
  const auth = await requireUser()
  if (!auth.ok) return { ok: false as const, res: auth.res }

  const { id: rawId, commentId: rawCommentId } = await resolveRouteParams(ctx)
  const lookPostId = pickString(rawId)
  const commentId = pickString(rawCommentId)

  if (!lookPostId) {
    return {
      ok: false as const,
      res: jsonFail(400, 'Missing look id.', { code: 'MISSING_LOOK_ID' }),
    }
  }

  if (!commentId) {
    return {
      ok: false as const,
      res: jsonFail(400, 'Missing comment id.', { code: 'MISSING_COMMENT_ID' }),
    }
  }

  const access = await loadLookAccess(prisma, {
    lookPostId,
    viewerClientId: auth.user.clientProfile?.id ?? null,
    viewerProfessionalId: auth.user.professionalProfile?.id ?? null,
  })

  if (!access) {
    return {
      ok: false as const,
      res: jsonFail(404, 'Not found.', { code: 'LOOK_NOT_FOUND' }),
    }
  }

  const policyInput = buildLookPolicyInput(access, auth.user.role ?? null)

  if (!canViewLookPost(policyInput)) {
    return {
      ok: false as const,
      res: jsonFail(404, 'Not found.', { code: 'LOOK_NOT_FOUND' }),
    }
  }

  if (!canCommentOnLookPost(policyInput)) {
    return {
      ok: false as const,
      res: jsonFail(403, 'You can’t react to this look.', {
        code: 'COMMENTS_FORBIDDEN',
      }),
    }
  }

  const comment = await prisma.lookComment.findFirst({
    where: {
      id: commentId,
      lookPostId,
      moderationStatus: ModerationStatus.APPROVED,
    },
    select: { id: true },
  })

  if (!comment) {
    return {
      ok: false as const,
      res: jsonFail(404, 'Not found.', { code: 'COMMENT_NOT_FOUND' }),
    }
  }

  return {
    ok: true as const,
    userId: auth.user.id,
    lookPostId,
    commentId: comment.id,
  }
}

export async function POST(_req: Request, ctx: CommentLikeContext) {
  try {
    const target = await resolveTarget(ctx)
    if (!target.ok) return target.res

    const result = await prisma.$transaction(
      async (tx): Promise<LooksCommentLikeResponseDto> => {
        try {
          await tx.lookCommentLike.create({
            data: { lookCommentId: target.commentId, userId: target.userId },
          })
        } catch (error) {
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== 'P2002'
          ) {
            throw error
          }
        }

        const likeCount = await recomputeLookCommentLikeCount(
          tx,
          target.commentId,
        )

        return {
          lookPostId: target.lookPostId,
          commentId: target.commentId,
          liked: true,
          likeCount,
        }
      },
    )

    return jsonOk(result, 200)
  } catch (e) {
    console.error('POST /api/looks/[id]/comments/[commentId]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function DELETE(_req: Request, ctx: CommentLikeContext) {
  try {
    const target = await resolveTarget(ctx)
    if (!target.ok) return target.res

    const result = await prisma.$transaction(
      async (tx): Promise<LooksCommentLikeResponseDto> => {
        await tx.lookCommentLike.deleteMany({
          where: { lookCommentId: target.commentId, userId: target.userId },
        })

        const likeCount = await recomputeLookCommentLikeCount(
          tx,
          target.commentId,
        )

        return {
          lookPostId: target.lookPostId,
          commentId: target.commentId,
          liked: false,
          likeCount,
        }
      },
    )

    return jsonOk(result, 200)
  } catch (e) {
    console.error('DELETE /api/looks/[id]/comments/[commentId]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.', {
      code: 'INTERNAL',
    })
  }
}
