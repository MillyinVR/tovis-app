// app/api/client/bookings/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.toUpperCase() : ''
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Only clients can view bookings.' }, { status: 401 })
    }

    const clientId = user.clientProfile.id
    const now = new Date()
    const next30 = addDays(now, 30)

    const bookings = await prisma.booking.findMany({
      where: { clientId },
      orderBy: { scheduledFor: 'asc' },
      take: 300,
      select: {
        id: true,
        status: true,
        source: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
        priceSnapshot: true,
        service: { select: { id: true, name: true } },
        professional: {
          select: { id: true, businessName: true, location: true, city: true, state: true },
        },
      },
    })

    let waitlist: any[] = []
    try {
      waitlist = await (prisma as any).waitlistEntry.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          serviceId: true,
          professionalId: true,
          notes: true,
          availability: true,
          service: { select: { id: true, name: true } },
          professional: {
            select: { id: true, businessName: true, location: true, city: true, state: true },
          },
        },
      })
    } catch {
      waitlist = []
    }

    const upcoming: any[] = []
    const pending: any[] = []
    const prebooked: any[] = []
    const past: any[] = []

    for (const b of bookings) {
      const when = new Date(b.scheduledFor)
      const isFuture = when.getTime() >= now.getTime()
      const within30 = when.getTime() < next30.getTime()

      const status = upper(b.status)
      const source = upper(b.source)

      // Past always wins
      if (!isFuture || status === 'COMPLETED' || status === 'CANCELLED') {
        past.push(b)
        continue
      }

      if (status === 'PENDING') {
        pending.push(b)
        continue
      }

      // Prebooked (aftercare) bucket
      if (source === 'AFTERCARE' && isFuture) {
        prebooked.push(b)
        continue
      }

      // Normal upcoming (accepted + within 30)
      if (status === 'ACCEPTED' && within30) {
        upcoming.push(b)
        continue
      }

      // Everything else future-ish goes to past for now (keeps UI simple)
      past.push(b)
    }

    return NextResponse.json(
      {
        ok: true,
        buckets: { upcoming, pending, waitlist, prebooked, past },
        meta: { now: now.toISOString(), next30: next30.toISOString() },
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/client/bookings error:', e)
    return NextResponse.json({ error: 'Failed to load client bookings.' }, { status: 500 })
  }
}
