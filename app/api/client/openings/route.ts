// app/api/client/openings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = user.clientProfile.id
    const url = new URL(req.url)
    const hours = Number(pickString(url.searchParams.get('hours')) || 48)
    const horizonHours = Number.isFinite(hours) ? Math.max(1, Math.min(168, Math.floor(hours))) : 48

    const now = new Date()
    const horizon = new Date(Date.now() + horizonHours * 60 * 60_000)

    const openings = await prisma.lastMinuteOpening.findMany({
      where: {
        status: 'ACTIVE',
        startAt: { gte: now, lte: horizon },
        offeringId: { not: null }, // we enforced offeringId for now
      },
      orderBy: { startAt: 'asc' },
      take: 50,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        discountPct: true,
        note: true,
        professionalId: true,
        serviceId: true,
        offeringId: true,
        professional: {
          select: { id: true, businessName: true, city: true, location: true, timeZone: true },
        },
        service: { select: { id: true, name: true } },
        notifications: {
          where: { clientId },
          select: { tier: true, sentAt: true, openedAt: true, clickedAt: true, bookedAt: true },
          take: 1,
        },
      },
    })

    return NextResponse.json({ openings }, { status: 200 })
  } catch (e) {
    console.error('GET /api/client/openings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
