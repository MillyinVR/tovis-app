// app/api/services/[id]/favorite/route.ts
import { prisma } from '@/lib/prisma'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'

export const dynamic = 'force-dynamic'

function pickTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s : null
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await resolveRouteParams(ctx)
    const serviceId = pickTrimmedString(id)
    if (!serviceId) return jsonFail(400, 'Missing service id.')

    const svc = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true },
    })
    if (!svc) return jsonFail(404, 'Service not found.')

    await prisma.serviceFavorite.upsert({
      where: { serviceId_userId: { serviceId, userId: user.id } },
      create: { serviceId, userId: user.id },
      update: {},
    })

    const count = await prisma.serviceFavorite.count({ where: { serviceId } })
    return jsonOk({ favorited: true, count })
  } catch (e: unknown) {
    console.error('POST /api/services/[id]/favorite error', e)
    const msg = e instanceof Error ? e.message : 'Internal server error'
    return jsonFail(500, msg)
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await resolveRouteParams(ctx)
    const serviceId = pickTrimmedString(id)
    if (!serviceId) return jsonFail(400, 'Missing service id.')

    await prisma.serviceFavorite.deleteMany({ where: { serviceId, userId: user.id } })

    const count = await prisma.serviceFavorite.count({ where: { serviceId } })
    return jsonOk({ favorited: false, count })
  } catch (e: unknown) {
    console.error('DELETE /api/services/[id]/favorite error', e)
    const msg = e instanceof Error ? e.message : 'Internal server error'
    return jsonFail(500, msg)
  }
}