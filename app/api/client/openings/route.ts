import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = user.clientProfile.id

    const notifications = await prisma.openingNotification.findMany({
      where: { clientId },
      orderBy: { sentAt: 'desc' },
      take: 50,
      select: {
        id: true,
        tier: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        clickedAt: true,
        bookedAt: true,
        opening: {
          select: {
            id: true,
            startAt: true,
            endAt: true,
            discountPct: true,
            note: true,
            professionalId: true,
            offeringId: true,
            serviceId: true,
            professional: {
              select: { id: true, businessName: true, city: true, location: true, timeZone: true, avatarUrl: true, state: true },
            },
            service: { select: { id: true, name: true } },
            offering: { select: { id: true, price: true, durationMinutes: true, title: true } },
          },
        },
      },
    })

    return NextResponse.json({ ok: true, notifications }, { status: 200 })
  } catch (e) {
    console.error('GET /api/client/openings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
