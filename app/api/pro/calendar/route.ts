import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PROFESSIONAL' || r === 'PRO'
}

function startOfDay(d: Date) {
  const nd = new Date(d)
  nd.setHours(0, 0, 0, 0)
  return nd
}

function endOfDay(d: Date) {
  const nd = new Date(d)
  nd.setHours(23, 59, 59, 999)
  return nd
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

export async function GET() {
  try {
    const user = await getCurrentUser().catch(() => null)

    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json(
        {
          error: 'Only professionals can view the pro calendar.',
          debug: {
            hasUser: Boolean(user),
            role: (user as any)?.role ?? null,
            hasProfessionalProfile: Boolean((user as any)?.professionalProfile?.id),
          },
        },
        { status: 401 },
      )
    }

    const professionalId = (user as any).professionalProfile.id as string

    // Fetch pro settings used by the calendar page (workingHours + autoAccept)
    const proProfile = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        workingHours: true,
        autoAcceptBookings: true,
      },
    })

    // Pull bookings for a reasonable window (today -> +60 days)
    const now = new Date()
    const from = startOfDay(now)
    const to = endOfDay(addMinutes(from, 60 * 24 * 60)) // ~60 days

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: from, lte: to },
        NOT: { status: 'CANCELLED' as any },
      },
      select: {
        id: true,
        scheduledFor: true,
        durationMinutesSnapshot: true,
        status: true,
        clientId: true,
        // If you have a relation called `client`, this makes names nicer.
        // If you don't, remove this include and we’ll just show "Client".
        client: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },
        // If you have relation `service`, use it for the title.
        service: { select: { name: true } },
      } as any,
      orderBy: { scheduledFor: 'asc' },
      take: 500,
    })

    const events = bookings.map((b: any) => {
      const start = new Date(b.scheduledFor)
      const dur = Number(b.durationMinutesSnapshot || 60)
      const end = addMinutes(start, Number.isFinite(dur) && dur > 0 ? dur : 60)

      const serviceName = b.service?.name || 'Appointment'

      const fn = b.client?.firstName?.trim() || ''
      const ln = b.client?.lastName?.trim() || ''
      const email = b.client?.user?.email || ''
      const clientName = (fn || ln) ? `${fn} ${ln}`.trim() : (email || 'Client')

      return {
        id: String(b.id),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        title: serviceName,
        clientName,
        status: b.status,
      }
    })

    // Stats for the top cards
    const todayStart = startOfDay(now)
    const todayEnd = endOfDay(now)

    const todaysBookings = bookings.filter((b: any) => {
      const s = new Date(b.scheduledFor).getTime()
      return s >= todayStart.getTime() && s <= todayEnd.getTime()
    }).length

    const pendingRequests = bookings.filter((b: any) => String(b.status) === 'PENDING').length

    // Placeholder for later when you add blocking and working-hours math.
    const stats = {
      todaysBookings,
      availableHours: null,
      pendingRequests,
      blockedHours: null,
    }

    return NextResponse.json(
      {
        ok: true,
        events,
        workingHours: proProfile?.workingHours ?? null,
        stats,
        autoAcceptBookings: Boolean(proProfile?.autoAcceptBookings),
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/pro/calendar error:', e)
    return NextResponse.json({ error: 'Failed to load pro calendar.' }, { status: 500 })
  }
}
