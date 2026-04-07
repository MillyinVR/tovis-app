// app/api/pro/notifications/[id]/mark-read/route.ts
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { markProNotificationRead } from '@/lib/notifications/proNotificationQueries'

export const dynamic = 'force-dynamic'

type Ctx = {
  params: { id: string } | Promise<{ id: string }>
}

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const professionalId = auth.professionalId

  const { id } = await Promise.resolve(ctx.params)
  const notificationId = pickString(id)

  if (!notificationId) {
    return jsonFail(400, 'Missing notification id.')
  }

  const found = await markProNotificationRead({
    professionalId,
    notificationId,
  })

  if (!found) {
    return jsonFail(404, 'Notification not found.')
  }

  return jsonOk({ ok: true }, 200)
}