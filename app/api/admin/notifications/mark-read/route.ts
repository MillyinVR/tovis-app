// app/api/admin/notifications/mark-read/route.ts
import { Role } from '@prisma/client'

import { jsonOk, requireUser } from '@/app/api/_utils'
import { markAllAdminNotificationsRead } from '@/lib/notifications/adminNotificationQueries'

export const dynamic = 'force-dynamic'

export async function POST() {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth.res

  const result = await markAllAdminNotificationsRead({
    adminUserId: auth.user.id,
  })

  return jsonOk(
    {
      ok: true,
      count: result.count,
    },
    200,
  )
}
