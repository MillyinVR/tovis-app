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
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

type ConsultationApprovalRow = {
  status: string | null
}

type BookingRow = {
  id: string
  status: string | null
  source: string | null
  sessionStep: string | null
  scheduledFor: Date
  durationMinutesSnapshot: number | null
  priceSnapshot: any
  service: { id: string; name: string } | null
  professional: {
    id: string
    businessName: string | null
    location: string | null
    city: string | null
    state: string | null
  } | null
  consultationApproval: ConsultationApprovalRow | null
  hasUnreadAftercare?: boolean
  hasPendingConsultationApproval?: boolean
}

function needsConsultationApproval(b: BookingRow) {
  // Final-product: if the pro sent consult for approval,
  // booking.sessionStep should be CONSULTATION_PENDING_CLIENT
  // and consultationApproval.status should be PENDING.
  const step = upper(b.sessionStep)
  const approval = upper(b.consultationApproval?.status)
  return step === 'CONSULTATION_PENDING_CLIENT' && approval === 'PENDING'
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

    // Fetch bookings (now includes sessionStep + consultationApproval)
    const bookings = (await prisma.booking.findMany({
      where: { clientId },
      orderBy: { scheduledFor: 'asc' },
      take: 300,
      select: {
        id: true,
        status: true,
        source: true,
        sessionStep: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
        priceSnapshot: true,
        service: { select: { id: true, name: true } },
        professional: { select: { id: true, businessName: true, location: true, city: true, state: true } },

        // Assumes your Prisma schema has a relation called consultationApproval
        // (1:1 or 1:many but represented as a single latest row).
        consultationApproval: { select: { status: true } },
      },
    })) as BookingRow[]

    /**
     * ✅ Policy A: unread-aftercare badges anywhere relevant.
     * Unread = clientNotification(type=AFTERCARE, readAt=null)
     */
    const unread = await prisma.clientNotification.findMany({
      where: {
        clientId,
        type: 'AFTERCARE',
        readAt: null,
        bookingId: { not: null },
      } as any,
      select: { bookingId: true },
      take: 1000,
    })

    const unreadBookingIds = new Set(
      unread
        .map((n: any) => (typeof n?.bookingId === 'string' ? n.bookingId : null))
        .filter(Boolean) as string[],
    )

    for (const b of bookings) {
      b.hasUnreadAftercare = unreadBookingIds.has(b.id)
      b.hasPendingConsultationApproval = needsConsultationApproval(b)
    }

    // ✅ Waitlist (kept as-is)
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

          preferredStart: true,
          preferredEnd: true,
          preferredTimeBucket: true,
          status: true,
          mediaId: true,

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

      // Past bucket
      if (!isFuture || status === 'COMPLETED' || status === 'CANCELLED') {
        past.push(b)
        continue
      }

      // ✅ Client action required: consultation approval
      // Put it in Pending so it can’t hide.
      if (b.hasPendingConsultationApproval) {
        pending.push(b)
        continue
      }

      // Regular “requested booking” pending
      if (status === 'PENDING') {
        pending.push(b)
        continue
      }

      // Prebooked (source AFTERCARE)
      if (source === 'AFTERCARE' && isFuture) {
        prebooked.push(b)
        continue
      }

      // Upcoming
      if (status === 'ACCEPTED' && within30) {
        upcoming.push(b)
        continue
      }

      // Default fallback
      upcoming.push(b)
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
