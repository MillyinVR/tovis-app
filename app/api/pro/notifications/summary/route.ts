// app/api/pro/notifications/summary/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export async function GET() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    return NextResponse.json({ hasUnread: false, count: 0 }, { status: 200 })
  }

  const db: any = prisma
  const proId = user.professionalProfile.id

  // Simple "something needs your attention":
  // - pending booking requests
  // - reviews from the last 7 days
  const [pendingCount, recentReviewCount] = await Promise.all([
    db.booking.count({
      where: {
        professionalId: proId,
        status: 'PENDING',
      },
    }),
    db.review.count({
      where: {
        professionalId: proId,
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ])

  const count = pendingCount + recentReviewCount

  return NextResponse.json(
    {
      hasUnread: count > 0,
      count,
    },
    { status: 200 },
  )
}
