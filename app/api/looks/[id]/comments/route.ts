// app/api/looks/[id]/comments/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickInt,
  pickString,
  requireUser,
} from '@/app/api/_utils'
import { getOptionalUser } from '@/app/api/_utils/auth/getOptionalUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { isRecord } from '@/lib/guards'
import {
  canCommentOnLookPost,
  canViewLookPost,
} from '@/lib/looks/guards'
import {
  recomputeLookCommentReplyCount,
  recomputeLookPostCommentCount,
} from '@/lib/looks/counters'
import { mapLooksCommentToDto } from '@/lib/looks/mappers'
import { buildLookCommentSelect } from '@/lib/looks/commentSelect'
import { buildLookPolicyInput, loadLookAccess } from '@/lib/looks/access'
import { ModerationStatus, Role } from '@prisma/client'
import type {
  LooksCommentCreateResponseDto,
  LooksCommentsListResponseDto,
} from '@/lib/looks/types'
import { enqueueRecomputeLookCounts } from '@/lib/jobs/looksSocial/enqueue'

export const dynamic = 'force-dynamic'

function readCommentBody(raw: unknown): string {
  if (!isRecord(raw)) return ''
  const body = raw.body
  return typeof body === 'string' ? body.trim() : ''
}

function readParentCommentId(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  return pickString(raw.parentCommentId)
}

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id: rawId } = await resolveRouteParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', { code: 'MISSING_LOOK_ID' })
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
    const requestedLimit = pickInt(searchParams.get('limit')) ?? 30
    const limit = Math.max(1, Math.min(requestedLimit, 100))

    const viewerUserId = viewer?.id ?? null
    const viewerIsAdmin = viewer?.role === Role.ADMIN

    // Top-level comments only; replies are loaded on demand per thread. The
    // look's stored commentCount already includes replies (matches IG/TikTok),
    // so we count all approved rows for the header, not just top-level ones.
    const [rows, commentsCount] = await prisma.$transaction([
      prisma.lookComment.findMany({
        where: {
          lookPostId,
          parentCommentId: null,
          moderationStatus: ModerationStatus.APPROVED,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: buildLookCommentSelect(viewerUserId),
      }),
      prisma.lookComment.count({
        where: {
          lookPostId,
          moderationStatus: ModerationStatus.APPROVED,
        },
      }),
    ])

    const body: LooksCommentsListResponseDto = {
      lookPostId,
      comments: rows.map((row) =>
        mapLooksCommentToDto(row, { viewerUserId, viewerIsAdmin }),
      ),
      commentsCount,
    }

    return jsonOk(body, 200)
  } catch (e) {
    console.error('GET /api/looks/[id]/comments error', e)
    return jsonFail(500, 'Couldn’t load comments. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', { code: 'MISSING_LOOK_ID' })
    }

    const access = await loadLookAccess(prisma, {
      lookPostId,
      viewerClientId: auth.user.clientProfile?.id ?? null,
      viewerProfessionalId: auth.user.professionalProfile?.id ?? null,
    })

    if (!access) {
      return jsonFail(404, 'Not found.', { code: 'LOOK_NOT_FOUND' })
    }

    const policyInput = buildLookPolicyInput(access, auth.user.role ?? null)

    if (!canViewLookPost(policyInput)) {
      return jsonFail(404, 'Not found.', { code: 'LOOK_NOT_FOUND' })
    }

    if (!canCommentOnLookPost(policyInput)) {
      return jsonFail(403, 'You can’t comment on this look.', {
        code: 'COMMENTS_FORBIDDEN',
      })
    }

    const rawBody: unknown = await req.json().catch(() => null)
    const text = readCommentBody(rawBody)
    const requestedParentId = readParentCommentId(rawBody)

    if (!text) {
      return jsonFail(400, 'Comment cannot be empty.', { code: 'EMPTY_COMMENT' })
    }

    if (text.length > 500) {
      return jsonFail(400, 'Comment too long (max 500).', {
        code: 'COMMENT_TOO_LONG',
      })
    }

    // Resolve the real parent. Threading is flattened to one level: replying to
    // a reply re-roots the new comment under that reply's top-level ancestor.
    let parentCommentId: string | null = null
    if (requestedParentId) {
      const parent = await prisma.lookComment.findFirst({
        where: {
          id: requestedParentId,
          lookPostId,
          moderationStatus: ModerationStatus.APPROVED,
        },
        select: { id: true, parentCommentId: true },
      })

      if (!parent) {
        return jsonFail(404, 'That comment is no longer available.', {
          code: 'PARENT_COMMENT_NOT_FOUND',
        })
      }

      parentCommentId = parent.parentCommentId ?? parent.id
    }

    const viewerUserId = auth.user.id
    const viewerIsAdmin = auth.user.role === Role.ADMIN

    const result = await prisma.$transaction(async (tx) => {
      const comment = await tx.lookComment.create({
        data: {
          lookPostId,
          userId: viewerUserId,
          parentCommentId,
          body: text,
        },
        select: buildLookCommentSelect(viewerUserId),
      })

      if (parentCommentId) {
        await recomputeLookCommentReplyCount(tx, parentCommentId)
      }

      const commentsCount = await recomputeLookPostCommentCount(tx, lookPostId)
      await enqueueRecomputeLookCounts(tx, { lookPostId })

      return { comment, commentsCount }
    })

    const body: LooksCommentCreateResponseDto = {
      lookPostId,
      comment: mapLooksCommentToDto(result.comment, {
        viewerUserId,
        viewerIsAdmin,
      }),
      commentsCount: result.commentsCount,
    }

    return jsonOk(body, 201)
  } catch (e) {
    console.error('POST /api/looks/[id]/comments error', e)
    return jsonFail(500, 'Couldn’t post that. Try again.', { code: 'INTERNAL' })
  }
}
