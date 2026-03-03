// app/api/professionals/[id]/favorite/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function pickTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await ctx.params
    const professionalId = pickTrimmedString(id)
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
  } catch (e: unknown) {
    console.error('POST /api/professionals/[id]/favorite error', e)
    const msg = e instanceof Error ? e.message : 'Internal server error'
    return jsonFail(500, msg)
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const { id } = await ctx.params
    const professionalId = pickTrimmedString(id)
    if (!professionalId) return jsonFail(400, 'Missing professional id.')

    await prisma.professionalFavorite.deleteMany({ where: { professionalId, userId: user.id } })

    const count = await prisma.professionalFavorite.count({ where: { professionalId } })
    return jsonOk({ favorited: false, count })
  } catch (e: unknown) {
    console.error('DELETE /api/professionals/[id]/favorite error', e)
    const msg = e instanceof Error ? e.message : 'Internal server error'
    return jsonFail(500, msg)
  }
}