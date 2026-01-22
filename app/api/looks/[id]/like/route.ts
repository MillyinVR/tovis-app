// app/api/looks/[id]/like/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

async function requirePublicEligibleLook(id: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { id: true, visibility: true, isEligibleForLooks: true, isFeaturedInPortfolio: true },
  })

  if (!media || media.visibility !== 'PUBLIC') return null
  const eligible = Boolean(media.isEligibleForLooks || media.isFeaturedInPortfolio)
  if (!eligible) return null

  return media
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (auth.res) return auth.res
    const user = auth.user

    const raw = await params
    const id = pickString(raw?.id)
    if (!id) return jsonFail(400, 'Missing media id.')

    const ok = await requirePublicEligibleLook(id)
    if (!ok) return jsonFail(404, 'Not found.')

    try {
      await prisma.mediaLike.create({ data: { mediaId: id, userId: user.id } })
    } catch (e: any) {
      // P2002 = already liked (idempotent)
      if (e?.code !== 'P2002') throw e
    }

    const likeCount = await prisma.mediaLike.count({ where: { mediaId: id } })
    return jsonOk({ ok: true, liked: true, likeCount }, 200)
  } catch (e) {
    console.error('POST /api/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.')
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (auth.res) return auth.res
    const user = auth.user

    const raw = await params
    const id = pickString(raw?.id)
    if (!id) return jsonFail(400, 'Missing media id.')

    const ok = await requirePublicEligibleLook(id)
    if (!ok) return jsonFail(404, 'Not found.')

    await prisma.mediaLike.deleteMany({ where: { mediaId: id, userId: user.id } })

    const likeCount = await prisma.mediaLike.count({ where: { mediaId: id } })
    return jsonOk({ ok: true, liked: false, likeCount }, 200)
  } catch (e) {
    console.error('DELETE /api/looks/[id]/like error', e)
    return jsonFail(500, 'Couldn’t update your like. Try again.')
  }
}
