// app/api/looks/[id]/comments/route.ts
import { prisma } from '@/lib/prisma'
import {
  jsonFail,
  jsonOk,
  pickInt,
  pickString,
  requireUser,
} from '@/app/api/_utils'
import { getCurrentUser } from '@/lib/currentUser'
import {
  canCommentOnLookPost,
  canViewLookPost,
} from '@/lib/looks/guards'
import { recomputeLookPostCommentCount } from '@/lib/looks/counters'
import { mapLooksCommentToDto } from '@/lib/looks/mappers'
import { loadLookAccess } from '@/lib/looks/access'
import {
  ModerationStatus,
  Prisma,
} from '@prisma/client'
import type {
  LooksCommentCreateResponseDto,
  LooksCommentsListResponseDto,
} from '@/lib/looks/types'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

const lookCommentSelect = Prisma.validator<Prisma.LookCommentSelect>()({
  id: true,
  body: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      clientProfile: {
        select: {
          firstName: true,
          lastName: true,
          avatarUrl: true,
        },
      },
      professionalProfile: {
        select: {
          businessName: true,
          avatarUrl: true,
        },
      },
    },
  },
})

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCommentText(raw: unknown): string {
  if (!isRecord(raw)) return ''

  const body = raw.body
  return typeof body === 'string' ? body.trim() : ''
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id: rawId } = await getParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', {
        code: 'MISSING_LOOK_ID',
      })
    }

    const viewer = await getCurrentUser().catch(() => null)

    const access = await loadLookAccess(prisma, {
      lookPostId,
      viewerClientId: viewer?.clientProfile?.id ?? null,
      viewerProfessionalId: viewer?.professionalProfile?.id ?? null,
    })

    if (!access) {
      return jsonFail(404, 'Not found.', {
        code: 'LOOK_NOT_FOUND',
      })
    }

    const canView = canViewLookPost({
      isOwner: access.isOwner,
      viewerRole: viewer?.role ?? null,
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

    const { searchParams } = new URL(req.url)
    const requestedLimit = pickInt(searchParams.get('limit')) ?? 30
    const limit = Math.max(1, Math.min(requestedLimit, 100))

    const [rows, commentsCount] = await prisma.$transaction([
      prisma.lookComment.findMany({
        where: {
          lookPostId,
          moderationStatus: ModerationStatus.APPROVED,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: lookCommentSelect,
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
      comments: rows.map(mapLooksCommentToDto),
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

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', {
        code: 'MISSING_LOOK_ID',
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

    const canComment = canCommentOnLookPost({
      isOwner: access.isOwner,
      viewerRole: auth.user.role ?? null,
      status: access.look.status,
      visibility: access.look.visibility,
      moderationStatus: access.look.moderationStatus,
      proVerificationStatus:
        access.look.professional.verificationStatus,
      viewerFollowsProfessional: access.viewerFollowsProfessional,
    })

    if (!canComment) {
      return jsonFail(403, 'You can’t comment on this look.', {
        code: 'COMMENTS_FORBIDDEN',
      })
    }

    const rawBody: unknown = await req.json().catch(() => null)
    const text = readCommentText(rawBody)

    if (!text) {
      return jsonFail(400, 'Comment cannot be empty.', {
        code: 'EMPTY_COMMENT',
      })
    }

    if (text.length > 500) {
      return jsonFail(400, 'Comment too long (max 500).', {
        code: 'COMMENT_TOO_LONG',
      })
    }

    const result = await prisma.$transaction(async (tx) => {
      const comment = await tx.lookComment.create({
        data: {
          lookPostId,
          userId: auth.user.id,
          body: text,
        },
        select: lookCommentSelect,
      })

      const commentsCount = await recomputeLookPostCommentCount(
        tx,
        lookPostId,
      )

      return {
        comment,
        commentsCount,
      }
    })

    const body: LooksCommentCreateResponseDto = {
      lookPostId,
      comment: mapLooksCommentToDto(result.comment),
      commentsCount: result.commentsCount,
    }

    return jsonOk(body, 201)
  } catch (e) {
    console.error('POST /api/looks/[id]/comments error', e)
    return jsonFail(500, 'Couldn’t post that. Try again.', {
      code: 'INTERNAL',
    })
  }
}