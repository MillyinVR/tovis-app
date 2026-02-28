// app/api/pro/notifications/summary/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requirePro()
  if (!auth.ok) {
    // If you *intentionally* want “unauthorized => no unread”
    // return jsonOk({ hasUnread: false, count: 0 }, 200)

    return auth.res
  }

  const count = await prisma.notification.count({
    where: { professionalId: auth.proId, readAt: null },
  })

  return jsonOk({ hasUnread: count > 0, count }, 200)
}