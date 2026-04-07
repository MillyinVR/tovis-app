// app/api/pro/notifications/mark-read/route.ts
import { jsonOk, requirePro } from '@/app/api/_utils'
import { markAllProNotificationsRead } from '@/lib/notifications/proNotificationQueries'

export const dynamic = 'force-dynamic'

export async function POST() {
  const auth = await requirePro()
  if (!auth.ok) return auth.res

  const result = await markAllProNotificationsRead({
    professionalId: auth.professionalId,
  })

  return jsonOk(
    {
      ok: true,
      count: result.count,
    },
    200,
  )
}