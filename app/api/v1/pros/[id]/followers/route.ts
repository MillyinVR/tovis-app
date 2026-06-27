// app/api/v1/pros/[id]/followers/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickInt, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  assertCanViewFollowersList,
  buildProFollowersListResponse,
  getFollowErrorMeta,
  listFollowersPage,
  requireFollowProfessionalTarget,
} from '@/lib/follows'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const professionalId = pickString(rawId)

    if (!professionalId) {
      return jsonFail(400, 'Missing pro id.', {
        code: 'MISSING_PRO_ID',
      })
    }

    assertCanViewFollowersList({
      viewerProfessionalId: auth.professionalId,
      ownerProfessionalId: professionalId,
    })

    const professional = await requireFollowProfessionalTarget(
      prisma,
      professionalId,
    )

    const { searchParams } = new URL(req.url)

    const page = await listFollowersPage(prisma, {
    professionalId: professional.id,
    viewerProfessionalId: auth.professionalId,
    take: pickInt(searchParams.get('take')) ?? undefined,
    skip: pickInt(searchParams.get('skip')) ?? undefined,
    })

    return jsonOk(
      buildProFollowersListResponse({
        professionalId: professional.id,
        followerCount: page.followerCount,
        items: page.items,
        pagination: page.pagination,
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

    console.error('GET /api/v1/pros/[id]/followers error', error)
    return jsonFail(500, 'Couldn’t load followers. Try again.', {
      code: 'INTERNAL',
    })
  }
}