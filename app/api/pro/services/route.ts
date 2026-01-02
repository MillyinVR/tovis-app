// app/api/pro/services/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PROFESSIONAL' || r === 'PRO'
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Only professionals can access this.' }, { status: 401 })
    }

    const professionalId = (user as any).professionalProfile.id as string

    const offerings = await prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
        service: { isActive: true },
      },
      select: {
        id: true,
        serviceId: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
        service: { select: { id: true, name: true, defaultDurationMinutes: true } },
      },
      orderBy: { service: { name: 'asc' } },
      take: 500,
    })

    // Your UI types currently expect { id, name, durationMinutes? }.
    // Keep "id" == serviceId so it matches booking.serviceId.
    const services = offerings.map((o) => ({
      id: o.serviceId,
      name: o.service.name,
      durationMinutes: o.salonDurationMinutes ?? o.mobileDurationMinutes ?? o.service.defaultDurationMinutes ?? null,
      offeringId: o.id, // extra, useful later
    }))

    return NextResponse.json({ ok: true, services }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/services error:', e)
    return NextResponse.json({ error: 'Failed to load services.' }, { status: 500 })
  }
}
