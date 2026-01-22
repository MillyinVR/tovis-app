// app/api/client/footer/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function clampSmallCount(n: number) {
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 99 ? '99+' : String(n)
}

export async function GET() {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const unreadAftercareCount = await prisma.clientNotification.count({
    where: {
      clientId: user.clientProfile.id,
      type: 'AFTERCARE',
      readAt: null,
    } as any,
  })

  return NextResponse.json({
    ok: true,
    inboxBadge: clampSmallCount(unreadAftercareCount),
  })
}
