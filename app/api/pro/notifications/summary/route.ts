// app/api/pro/notifications/summary/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requirePro().catch(() => null)

  if (!auth || auth.res) {
    return jsonOk({ hasUnread: false, count: 0 }, 200)
  }

  const professionalId = auth.professionalId

  const count = await prisma.notification.count({
    where: { professionalId, readAt: null },
  })

  return jsonOk({ hasUnread: count > 0, count }, 200)
}
