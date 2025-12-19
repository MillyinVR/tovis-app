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

type BookingRow = {
  id: string
  status: string | null
  source: string | null
  scheduledFor: Date
  durationMinutesSnapshot: number | null
  priceSnapshot: any
  service: { id: string; name: string } | null
  professional: { id: string; businessName: string | null; location: string | null; city: string | null; state: string | null } | null
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

    const bookings = (await prisma.booking.findMany({
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
        professional: { select: { id: true, businessName: true, location: true, city: true, state: true } },
      },
    })) as BookingRow[]

    // ✅ Waitlist (no "any" + no silent failure)
    let waitlist: any[] = []
    try {
      waitlist = await prisma.waitlistEntry.findMany({
        where: { clientId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          createdAt: true,
          serviceId: true,
          professionalId: true,
          notes: true,

          // ✅ Pick ONE model shape:

          // If your schema uses preferred window fields:
          preferredStart: true,
          preferredEnd: true,
          preferredTimeBucket: true,
          status: true,
          mediaId: true,

          // If you *actually* added `availability` to Prisma, use this instead and remove the preferred* fields:
          // availability: true,

          service: { select: { id: true, name: true } },
          professional: { select: { id: true, businessName: true, location: true, city: true, state: true } },
        },
      })
    } catch (e) {
      console.error('GET /api/client/bookings waitlist error:', e)
      waitlist = []
    }

    const upcoming: BookingRow[] = []
    const pending: BookingRow[] = []
    const prebooked: BookingRow[] = []
    const past: BookingRow[] = []

    for (const b of bookings) {
      const when = new Date(b.scheduledFor)
      const isFuture = when.getTime() >= now.getTime()
      const within30 = when.getTime() < next30.getTime()

      const status = upper(b.status)
      const source = upper(b.source)

      if (!isFuture || status === 'COMPLETED' || status === 'CANCELLED') {
        past.push(b)
        continue
      }

      if (status === 'PENDING') {
        pending.push(b)
        continue
      }

      if (source === 'AFTERCARE' && isFuture) {
        prebooked.push(b)
        continue
      }

      if (status === 'ACCEPTED' && within30) {
        upcoming.push(b)
        continue
      }

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
