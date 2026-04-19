// app/api/looks/[id]/like/route.ts
import { Prisma, Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import {
  canSaveLookPost,
  canViewLookPost,
} from '@/lib/looks/guards'
import { recomputeLookPostLikeCount } from '@/lib/looks/counters'

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

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
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

export async function POST(_req: Request, ctx: Ctx) {
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

    const canLike = canSaveLookPost({
      isOwner: access.isOwner,
      viewerRole: viewer?.role ?? null,
      status: access.look.status,
      visibility: access.look.visibility,
      moderationStatus: access.look.moderationStatus,
      proVerificationStatus:
        access.look.professional.verificationStatus,
      viewerFollowsProfessional: access.viewerFollowsProfessional,
    })

    if (!canLike) {
      return jsonFail(403, 'You can’t like this look.', {
        code: 'LIKE_FORBIDDEN',
      })
    }

    const result = await prisma.$transaction(async (tx) => {
      try {
        await tx.lookLike.create({
          data: {
            lookPostId,
            userId: auth.user.id,
          },
        })
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error
        }
      }

      const likeCount = await recomputeLookPostLikeCount(tx, lookPostId)

      return {
        liked: true,
        likeCount,
      }
    })

    return jsonOk(result, 200)
  } catch (e) {
    console.error('POST /api/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
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

    await prisma.$transaction(async (tx) => {
      await tx.lookLike.deleteMany({
        where: {
          lookPostId,
          userId: auth.user.id,
        },
      })

      await recomputeLookPostLikeCount(tx, lookPostId)
    })

    const likeCount = await prisma.lookPost.findUnique({
      where: { id: lookPostId },
      select: { likeCount: true },
    })

    return jsonOk(
      {
        liked: false,
        likeCount: likeCount?.likeCount ?? 0,
      },
      200,
    )
  } catch (e) {
    console.error('DELETE /api/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.', {
      code: 'INTERNAL',
    })
  }
}