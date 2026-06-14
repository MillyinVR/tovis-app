// app/api/pros/[id]/follow/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  buildProFollowStateResponse,
  getFollowErrorMeta,
  getProfessionalFollowState,
  requireFollowProfessionalTarget,
  toggleProFollow,
} from '@/lib/follows'
import { createLookFollowerNewProNotification } from '@/lib/notifications/lookFollowerNew'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const professionalId = pickString(rawId)

    if (!professionalId) {
      return jsonFail(400, 'Missing pro id.', {
        code: 'MISSING_PRO_ID',
      })
    }

    const professional = await requireFollowProfessionalTarget(
      prisma,
      professionalId,
    )

    const state = await getProfessionalFollowState(prisma, {
      viewerClientId: auth.clientId,
      professionalId: professional.id,
    })

    return jsonOk(
      buildProFollowStateResponse({
        professionalId: professional.id,
        following: state.following,
        followerCount: state.followerCount,
      }),
      200,
    )
  } catch (error) {
    const followError = getFollowErrorMeta(error)
    if (followError) {
      return jsonFail(followError.status, followError.message, {
        code: followError.code,
      })
    }

    console.error('GET /api/pros/[id]/follow error', error)
    return jsonFail(500, 'Couldn’t load follow state. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const professionalId = pickString(rawId)

    if (!professionalId) {
      return jsonFail(400, 'Missing pro id.', {
        code: 'MISSING_PRO_ID',
      })
    }

    const professional = await requireFollowProfessionalTarget(
      prisma,
      professionalId,
    )

    if (
      auth.user.id === professional.userId ||
      auth.user.professionalProfile?.id === professional.id
    ) {
      return jsonFail(403, 'You can’t follow yourself.', {
        code: 'SELF_FOLLOW_FORBIDDEN',
      })
    }

    const state = await toggleProFollow(prisma, {
      clientId: auth.clientId,
      professionalId: professional.id,
    })

    if (state.following) {
      // Best-effort: the follow already succeeded; a notification failure must
      // never fail the request or roll anything back.
      await createLookFollowerNewProNotification({
        professionalId: professional.id,
        followerUserId: auth.user.id,
      }).catch((error) => {
        console.error('POST /api/pros/[id]/follow notify error', error)
      })
    }

    return jsonOk(
      buildProFollowStateResponse({
        professionalId: professional.id,
        following: state.following,
        followerCount: state.followerCount,
      }),
      200,
    )
  } catch (error) {
    const followError = getFollowErrorMeta(error)
    if (followError) {
      return jsonFail(followError.status, followError.message, {
        code: followError.code,
      })
    }

    console.error('POST /api/pros/[id]/follow error', error)
    return jsonFail(500, 'Couldn’t update follow state. Try again.', {
      code: 'INTERNAL',
    })
  }
}