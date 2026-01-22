// app/api/pro/notifications/summary/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requirePro().catch(() => null)

  // If not pro, do NOT error—UI wants quiet summary.
  if (!auth || auth.res) {
    return jsonOk({ hasUnread: false, count: 0 }, 200)
  }

  const professionalId = auth.professionalId
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [pendingCount, recentReviewCount] = await Promise.all([
    prisma.booking.count({
      where: { professionalId, status: 'PENDING' as any },
    }),
    prisma.review.count({
      where: { professionalId, createdAt: { gte: since } },
    }),
  ])

  const count = pendingCount + recentReviewCount
  return jsonOk({ hasUnread: count > 0, count }, 200)
}
