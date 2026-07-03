// app/api/v1/looks/[id]/comments/[commentId]/replies/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString } from '@/app/api/_utils'
import { getOptionalUser } from '@/app/api/_utils/auth/getOptionalUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { buildLookPolicyInput, loadLookAccess } from '@/lib/looks/access'
import { canViewLookPost } from '@/lib/looks/guards'
import { mapLooksCommentToDto } from '@/lib/looks/mappers'
import { buildLookCommentSelect } from '@/lib/looks/commentSelect'
import { loadClientLinkViewer } from '@/lib/clientVisibility'
import { ModerationStatus, Role } from '@prisma/client'
import type { LooksCommentRepliesListResponseDto } from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  ctx: RouteContext<{ id: string; commentId: string }>,
) {
  try {
    const { id: rawId, commentId: rawCommentId } = await resolveRouteParams(ctx)
    const lookPostId = pickString(rawId)
    const parentCommentId = pickString(rawCommentId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', { code: 'MISSING_LOOK_ID' })
    }

    if (!parentCommentId) {
      return jsonFail(400, 'Missing comment id.', { code: 'MISSING_COMMENT_ID' })
    }

    const viewer = await getOptionalUser()

    const access = await loadLookAccess(prisma, {
      lookPostId,
      viewerClientId: viewer?.clientProfile?.id ?? null,
      viewerProfessionalId: viewer?.professionalProfile?.id ?? null,
    })

    if (!access) {
      return jsonFail(404, 'Not found.', { code: 'LOOK_NOT_FOUND' })
    }

    if (!canViewLookPost(buildLookPolicyInput(access, viewer?.role ?? null))) {
      return jsonFail(404, 'Not found.', { code: 'LOOK_NOT_FOUND' })
    }

    const { searchParams } = new URL(req.url)
    const requestedLimit = pickInt(searchParams.get('limit')) ?? 50
    const limit = Math.max(1, Math.min(requestedLimit, 100))

    const viewerUserId = viewer?.id ?? null
    const viewerIsAdmin = viewer?.role === Role.ADMIN
    const clientLinkViewer = await loadClientLinkViewer(viewer)

    // Replies read oldest-first (conversation order), matching IG threads.
    const [rows, replyCount] = await prisma.$transaction([
      prisma.lookComment.findMany({
        where: {
          lookPostId,
          parentCommentId,
          moderationStatus: ModerationStatus.APPROVED,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: buildLookCommentSelect(viewerUserId),
      }),
      prisma.lookComment.count({
        where: {
          lookPostId,
          parentCommentId,
          moderationStatus: ModerationStatus.APPROVED,
        },
      }),
    ])

    const body: LooksCommentRepliesListResponseDto = {
      lookPostId,
      parentCommentId,
      replies: rows.map((row) =>
        mapLooksCommentToDto(row, {
          viewerUserId,
          viewerIsAdmin,
          clientLinkViewer,
          lookAuthor: {
            professionalId: access.look.professionalId,
            clientAuthorId: access.look.clientAuthorId,
          },
        }),
      ),
      replyCount,
    }

    return jsonOk(body, 200)
  } catch (e) {
    console.error(
      'GET /api/v1/looks/[id]/comments/[commentId]/replies error',
      e,
    )
    return jsonFail(500, 'Couldn’t load replies. Try again.', {
      code: 'INTERNAL',
    })
  }
}
