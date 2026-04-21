import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import { loadLookAccess } from '@/lib/looks/access'
import { canViewLookPost } from '@/lib/looks/guards'
import {
  createLookCommentReport,
  findReportableLookComment,
} from '@/lib/looks/reporting'
import type { LooksCommentReportResponseDto } from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

type Params = {
  id: string
  commentId: string
}

type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { id: rawId, commentId: rawCommentId } = await getParams(ctx)
    const lookPostId = pickString(rawId)
    const commentId = pickString(rawCommentId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', {
        code: 'MISSING_LOOK_ID',
      })
    }

    if (!commentId) {
      return jsonFail(400, 'Missing comment id.', {
        code: 'MISSING_COMMENT_ID',
      })
    }

    const access = await loadLookAccess(prisma, {
      lookPostId,
      viewerClientId: auth.user.clientProfile?.id ?? null,
      viewerProfessionalId: auth.user.professionalProfile?.id ?? null,
    })

    if (!access) {
      return jsonFail(404, 'Not found.', {
        code: 'LOOK_NOT_FOUND',
      })
    }

    const canView = canViewLookPost({
      isOwner: access.isOwner,
      viewerRole: auth.user.role ?? null,
      status: access.look.status,
      visibility: access.look.visibility,
      moderationStatus: access.look.moderationStatus,
      proVerificationStatus:
        access.look.professional.verificationStatus,
      viewerFollowsProfessional: access.viewerFollowsProfessional,
    })

    if (!canView) {
      return jsonFail(404, 'Not found.', {
        code: 'LOOK_NOT_FOUND',
      })
    }

    const comment = await findReportableLookComment(prisma, {
      lookPostId,
      commentId,
    })

    if (!comment) {
      return jsonFail(404, 'Not found.', {
        code: 'COMMENT_NOT_FOUND',
      })
    }

    const result = await createLookCommentReport(prisma, {
      lookCommentId: comment.id,
      userId: auth.user.id,
    })

    const body: LooksCommentReportResponseDto = {
      lookPostId,
      commentId: comment.id,
      status: result.status,
    }

    return jsonOk(body, result.status === 'accepted' ? 201 : 200)
  } catch (e) {
    console.error(
      'POST /api/looks/[id]/comments/[commentId]/report error',
      e,
    )
    return jsonFail(500, 'Couldn’t submit that report. Try again.', {
      code: 'INTERNAL',
    })
  }
}