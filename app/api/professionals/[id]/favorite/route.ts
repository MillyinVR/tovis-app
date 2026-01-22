// app/api/professionals/[id]/favorite/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id: raw } = await Promise.resolve(ctx.params as any)
    const professionalId = pickString(raw)
    if (!professionalId) return jsonFail(400, 'Missing professional id.')

    const pro = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { id: true },
    })
    if (!pro) return jsonFail(404, 'Professional not found.')

    await prisma.professionalFavorite.upsert({
      where: { professionalId_userId: { professionalId, userId: user.id } },
      create: { professionalId, userId: user.id },
      update: {},
    })

    const count = await prisma.professionalFavorite.count({ where: { professionalId } })
    return jsonOk({ favorited: true, count })
  } catch (e) {
    console.error('POST /api/professionals/[id]/favorite error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id: raw } = await Promise.resolve(ctx.params as any)
    const professionalId = pickString(raw)
    if (!professionalId) return jsonFail(400, 'Missing professional id.')

    await prisma.professionalFavorite.deleteMany({ where: { professionalId, userId: user.id } })

    const count = await prisma.professionalFavorite.count({ where: { professionalId } })
    return jsonOk({ favorited: false, count })
  } catch (e) {
    console.error('DELETE /api/professionals/[id]/favorite error', e)
    return jsonFail(500, 'Internal server error')
  }
}
