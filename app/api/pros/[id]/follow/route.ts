// app/api/pros/[id]/follow/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import {
  buildProFollowStateResponse,
  getFollowErrorMeta,
  getProfessionalFollowState,
  requireFollowProfessionalTarget,
  toggleProFollow,
} from '@/lib/follows'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
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

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
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