// app/api/looks/[id]/like/route.ts
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import { isPublicLooksEligibleMedia } from '@/lib/looks/guards'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

async function requirePublicEligibleLook(id: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: {
      id: true,
      visibility: true,
      isEligibleForLooks: true,
      isFeaturedInPortfolio: true,
    },
  })

  if (!media) return null
  return isPublicLooksEligibleMedia(media) ? media : null
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const user = auth.user

    const { id: rawId } = await getParams(ctx)
    const id = pickString(rawId)
    if (!id) return jsonFail(400, 'Missing media id.')

    const media = await requirePublicEligibleLook(id)
    if (!media) return jsonFail(404, 'Not found.')

    try {
      await prisma.mediaLike.create({
        data: {
          mediaId: id,
          userId: user.id,
        },
      })
    } catch (error) {
      // P2002 = already liked (idempotent)
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error
      }
    }

    const likeCount = await prisma.mediaLike.count({
      where: { mediaId: id },
    })

    return jsonOk({ liked: true, likeCount }, 200)
  } catch (e) {
    console.error('POST /api/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const user = auth.user

    const { id: rawId } = await getParams(ctx)
    const id = pickString(rawId)
    if (!id) return jsonFail(400, 'Missing media id.')

    const media = await requirePublicEligibleLook(id)
    if (!media) return jsonFail(404, 'Not found.')

    await prisma.mediaLike.deleteMany({
      where: {
        mediaId: id,
        userId: user.id,
      },
    })

    const likeCount = await prisma.mediaLike.count({
      where: { mediaId: id },
    })

    return jsonOk({ liked: false, likeCount }, 200)
  } catch (e) {
    console.error('DELETE /api/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.')
  }
}