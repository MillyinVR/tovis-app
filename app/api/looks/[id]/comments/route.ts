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
import {
  ModerationStatus,
  Prisma,
  Role,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

type LookViewer = {
  id: string
  role: Role
  clientProfile: { id: string } | null
  professionalProfile: { id: string } | null
} | null

const lookAccessSelect = Prisma.validator<Prisma.LookPostSelect>()({
  id: true,
  professionalId: true,
  status: true,
  visibility: true,
  moderationStatus: true,
  professional: {
    select: {
      verificationStatus: true,
    },
  },
})

type LookAccessRow = Prisma.LookPostGetPayload<{
  select: typeof lookAccessSelect
}>

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

function isLookOwner(args: {
  viewer: LookViewer
  professionalId: string
}): boolean {
  return (
    args.viewer?.role === Role.PRO &&
    args.viewer.professionalProfile?.id === args.professionalId
  )
}

async function getViewerFollowState(args: {
  viewer: LookViewer
  look: LookAccessRow
  isOwner: boolean
}): Promise<boolean> {
  if (args.isOwner) return false
  if (!args.viewer?.clientProfile?.id) return false

  const follow = await prisma.proFollow.findUnique({
    where: {
      clientId_professionalId: {
        clientId: args.viewer.clientProfile.id,
        professionalId: args.look.professionalId,
      },
    },
    select: { id: true },
  })

  return Boolean(follow)
}

async function loadLookAccess(args: {
  lookPostId: string
  viewer: LookViewer
}): Promise<{
  look: LookAccessRow
  isOwner: boolean
  viewerFollowsProfessional: boolean
} | null> {
  const look = await prisma.lookPost.findUnique({
    where: { id: args.lookPostId },
    select: lookAccessSelect,
  })

  if (!look) return null

  const isOwner = isLookOwner({
    viewer: args.viewer,
    professionalId: look.professionalId,
  })

  const viewerFollowsProfessional = await getViewerFollowState({
    viewer: args.viewer,
    look,
    isOwner,
  })

  return {
    look,
    isOwner,
    viewerFollowsProfessional,
  }
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

    const access = await loadLookAccess({
      lookPostId,
      viewer,
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
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
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

    return jsonOk(
      {
        comments: rows.map(mapLooksCommentToDto),
        commentsCount,
      },
      200,
    )
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

    const viewer: LookViewer = auth.user

    const { id: rawId } = await getParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.', {
        code: 'MISSING_LOOK_ID',
      })
    }

    const access = await loadLookAccess({
      lookPostId,
      viewer,
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

    const canComment = canCommentOnLookPost({
      isOwner: access.isOwner,
      viewerRole: viewer?.role ?? null,
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

    return jsonOk(
      {
        comment: mapLooksCommentToDto(result.comment),
        commentsCount: result.commentsCount,
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/looks/[id]/comments error', e)
    return jsonFail(500, 'Couldn’t post that. Try again.', {
      code: 'INTERNAL',
    })
  }
}