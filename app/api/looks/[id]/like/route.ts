// app/api/looks/[id]/like/route.ts
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import {
  canSaveLookPost,
  canViewLookPost,
} from '@/lib/looks/guards'
import { recomputeLookPostLikeCount } from '@/lib/looks/counters'
import { loadLookAccess } from '@/lib/looks/access'
import type { LooksLikeResponseDto } from '@/lib/looks/types'
import { enqueueRecomputeLookCounts } from '@/lib/jobs/looksSocial/enqueue'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function POST(_req: Request, ctx: Ctx) {
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

    const canLike = canSaveLookPost({
      isOwner: access.isOwner,
      viewerRole: auth.user.role ?? null,
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

    const result = await prisma.$transaction(
      async (tx): Promise<LooksLikeResponseDto> => {
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
    await enqueueRecomputeLookCounts(tx, { lookPostId })

    return {
      lookPostId,
      liked: true,
      likeCount,
    }
      },
    )

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

    const result = await prisma.$transaction(
      async (tx): Promise<LooksLikeResponseDto> => {
        await tx.lookLike.deleteMany({
          where: {
            lookPostId,
            userId: auth.user.id,
          },
        })

        const likeCount = await recomputeLookPostLikeCount(tx, lookPostId)
        await enqueueRecomputeLookCounts(tx, { lookPostId })

        return {
          lookPostId,
          liked: false,
          likeCount,
        }
      },
    )

    return jsonOk(result, 200)
  } catch (e) {
    console.error('DELETE /api/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.', {
      code: 'INTERNAL',
    })
  }
}