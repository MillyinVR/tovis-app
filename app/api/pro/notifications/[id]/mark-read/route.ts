// app/api/pro/notifications/[id]/mark-read/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro, pickString } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requirePro()
  if (auth.res) return auth.res
  const professionalId = auth.professionalId

  const { id } = await Promise.resolve(ctx.params)
  const notifId = pickString(id)
  if (!notifId) return jsonFail(400, 'Missing notification id.')

  // Ensure ownership
  const updated = await prisma.notification.updateMany({
    where: { id: notifId, professionalId },
    data: { readAt: new Date() },
  })

  if (updated.count !== 1) return jsonFail(404, 'Notification not found.')

  return jsonOk({ ok: true }, 200)
}
