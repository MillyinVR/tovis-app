// app/api/pro/notifications/mark-read/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function POST() {
  const auth = await requirePro()
  if (auth.res) return auth.res

  const professionalId = auth.professionalId

  await prisma.notification.updateMany({
    where: { professionalId, readAt: null },
    data: { readAt: new Date() },
  })

  return jsonOk({ ok: true }, 200)
}
