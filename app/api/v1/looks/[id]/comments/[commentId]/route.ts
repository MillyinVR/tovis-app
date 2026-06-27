// app/api/v1/looks/[id]/comments/[commentId]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { buildLookPolicyInput, loadLookAccess } from '@/lib/looks/access'
import { canViewLookPost } from '@/lib/looks/guards'
import {
  recomputeLookCommentReplyCount,
  recomputeLookPostCommentCount,
} from '@/lib/looks/counters'
import { ModerationStatus, Role } from '@prisma/client'
import type { LooksCommentDeleteResponseDto } from '@/lib/looks/types'
import { enqueueRecomputeLookCounts } from '@/lib/jobs/looksSocial/enqueue'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: Request,
  ctx: RouteContext<{ id: string; commentId: string }>,
) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { id: rawId, commentId: rawCommentId } = await resolveRouteParams(ctx)
    const lookPostId = pickString(rawId)
    const commentId = pickString(rawCommentId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', { code: 'MISSING_LOOK_ID' })
    }

    if (!commentId) {
      return jsonFail(400, 'Missing comment id.', { code: 'MISSING_COMMENT_ID' })
    }

    const access = await loadLookAccess(prisma, {
      lookPostId,
      viewerClientId: auth.user.clientProfile?.id ?? null,
      viewerProfessionalId: auth.user.professionalProfile?.id ?? null,
    })

    if (!access) {
      return jsonFail(404, 'Not found.', { code: 'LOOK_NOT_FOUND' })
    }

    if (!canViewLookPost(buildLookPolicyInput(access, auth.user.role ?? null))) {
      return jsonFail(404, 'Not found.', { code: 'LOOK_NOT_FOUND' })
    }

    const comment = await prisma.lookComment.findFirst({
      where: {
        id: commentId,
        lookPostId,
        moderationStatus: ModerationStatus.APPROVED,
      },
      select: { id: true, userId: true, parentCommentId: true },
    })

    if (!comment) {
      return jsonFail(404, 'Not found.', { code: 'COMMENT_NOT_FOUND' })
    }

    const isAuthor = comment.userId === auth.user.id
    const isAdmin = auth.user.role === Role.ADMIN

    if (!isAuthor && !isAdmin) {
      return jsonFail(403, 'You can’t delete this comment.', {
        code: 'COMMENT_DELETE_FORBIDDEN',
      })
    }

    const result = await prisma.$transaction(async (tx) => {
      const removedAt = new Date()

      await tx.lookComment.update({
        where: { id: comment.id },
        data: { moderationStatus: ModerationStatus.REMOVED, removedAt },
        select: { id: true },
      })

      // Deleting a top-level comment takes its visible thread with it (IG
      // behavior). Replies are soft-removed too so the counts stay honest.
      if (comment.parentCommentId === null) {
        await tx.lookComment.updateMany({
          where: {
            parentCommentId: comment.id,
            moderationStatus: ModerationStatus.APPROVED,
          },
          data: { moderationStatus: ModerationStatus.REMOVED, removedAt },
        })
      } else {
        await recomputeLookCommentReplyCount(tx, comment.parentCommentId)
      }

      const commentsCount = await recomputeLookPostCommentCount(tx, lookPostId)
      await enqueueRecomputeLookCounts(tx, { lookPostId })

      return { commentsCount }
    })

    const body: LooksCommentDeleteResponseDto = {
      lookPostId,
      commentId: comment.id,
      deleted: true,
      commentsCount: result.commentsCount,
    }

    return jsonOk(body, 200)
  } catch (e) {
    console.error('DELETE /api/v1/looks/[id]/comments/[commentId] error', e)
    return jsonFail(500, 'Couldn’t delete that comment. Try again.', {
      code: 'INTERNAL',
    })
  }
}
