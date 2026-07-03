// app/api/v1/looks/[id]/like/route.ts
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  canSaveLookPost,
  canViewLookPost,
} from '@/lib/looks/guards'
import { recomputeLookPostLikeCount } from '@/lib/looks/counters'
import { loadLookAccess } from '@/lib/looks/access'
import type { LooksLikeResponseDto } from '@/lib/looks/types'
import { enqueueRecomputeLookCounts } from '@/lib/jobs/looksSocial/enqueue'
import { notifyLookLiked } from '@/lib/notifications/lookEngagement'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
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

    // Best-effort batched notification — the like is already committed, so a
    // notify failure must never fail the request (mirrors the comments route).
    // Self-likes are skipped inside the helper.
    await notifyLookLiked({
      lookPostId,
      look: {
        professionalId: access.look.professionalId,
        clientAuthorId: access.look.clientAuthorId,
      },
      actor: {
        userId: auth.user.id,
        clientProfileId: auth.user.clientProfile?.id ?? null,
        professionalProfileId: auth.user.professionalProfile?.id ?? null,
      },
      count: result.likeCount,
    }).catch((error) => {
      console.error('POST /api/v1/looks/[id]/like notify error', error)
    })
    kickNotificationDrain()

    return jsonOk(result, 200)
  } catch (e) {
    console.error('POST /api/v1/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
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
    console.error('DELETE /api/v1/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.', {
      code: 'INTERNAL',
    })
  }
}