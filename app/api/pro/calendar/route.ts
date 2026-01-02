// app/api/pro/calendar/route.ts
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

function pickPositiveNumber(v: any, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function hoursRounded(minutes: number) {
  const h = minutes / 60
  // round to nearest 0.5h for nicer display
  return Math.round(h * 2) / 2
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

    // Pro settings used by calendar page
    const proProfile = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        workingHours: true,
        autoAcceptBookings: true,
      },
    })

    // Window: today -> ~60 days
    const now = new Date()
    const from = startOfDay(now)
    const to = endOfDay(addMinutes(from, 60 * 24 * 60))

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: from, lte: to },
        NOT: { status: 'CANCELLED' as any },
      },
      select: {
        id: true,
        scheduledFor: true,
        status: true,

        // ✅ Source of truth
        totalDurationMinutes: true,
        bufferMinutes: true,

        // ⛑ Migration fallback
        durationMinutesSnapshot: true,

        client: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },

        service: { select: { name: true } },
      } as any,
      orderBy: { scheduledFor: 'asc' },
      take: 500,
    })

    const events = bookings.map((b: any) => {
      const start = new Date(b.scheduledFor)

      // Prefer totalDurationMinutes, fallback to snapshot, then 60.
      const baseDuration = pickPositiveNumber(b.totalDurationMinutes, pickPositiveNumber(b.durationMinutesSnapshot, 60))

      // Buffer is extra time that should appear in end time.
      const buffer = pickPositiveNumber(b.bufferMinutes, 0)

      const end = addMinutes(start, baseDuration + buffer)

      const status = String(b.status || '').toUpperCase()

      const serviceName =
        status === 'BLOCKED'
          ? 'Blocked time'
          : status === 'WAITLIST'
            ? 'Waitlist'
            : b.service?.name || 'Appointment'

      const fn = (b.client?.firstName || '').trim()
      const ln = (b.client?.lastName || '').trim()
      const email = (b.client?.user?.email || '').trim()

      const clientName =
        status === 'BLOCKED'
          ? 'Personal'
          : fn || ln
            ? `${fn} ${ln}`.trim()
            : email || (status === 'WAITLIST' ? 'Client' : 'Client')

      return {
        id: String(b.id),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        title: serviceName,
        clientName,
        status: status as any,
        // UI helper (duration *without* buffer so resize/maths are stable)
        durationMinutes: baseDuration,
      }
    })

    // Today window
    const todayStart = startOfDay(now)
    const todayEnd = endOfDay(now)

    // Stats + management lists
    const isToday = (iso: string) => {
      const t = new Date(iso).getTime()
      return t >= todayStart.getTime() && t <= todayEnd.getTime()
    }

    const todaysBookingsEvents = events.filter((e: any) => {
      const s = String(e.status || '').toUpperCase()
      return isToday(e.startsAt) && (s === 'ACCEPTED' || s === 'COMPLETED')
    })

    const pendingRequestEvents = events.filter((e: any) => {
      const s = String(e.status || '').toUpperCase()
      if (s !== 'PENDING') return false
      // Future-facing: pending on/after now
      return new Date(e.startsAt).getTime() >= now.getTime()
    })

    const waitlistTodayEvents = events.filter((e: any) => {
      const s = String(e.status || '').toUpperCase()
      return isToday(e.startsAt) && s === 'WAITLIST'
    })

    const blockedTodayEvents = events.filter((e: any) => {
      const s = String(e.status || '').toUpperCase()
      return isToday(e.startsAt) && s === 'BLOCKED'
    })

    const blockedMinutesToday = blockedTodayEvents.reduce((acc: number, e: any) => {
      const s = new Date(e.startsAt).getTime()
      const en = new Date(e.endsAt).getTime()
      const mins = Math.max(0, Math.round((en - s) / 60_000))
      return acc + mins
    }, 0)

    const stats = {
      // NOTE: this is now the real interpretation: accepted+completed today
      todaysBookings: todaysBookingsEvents.length,
      availableHours: null,
      pendingRequests: pendingRequestEvents.length,
      blockedHours: blockedMinutesToday ? hoursRounded(blockedMinutesToday) : 0,
    }

    return NextResponse.json(
      {
        ok: true,
        events,
        workingHours: proProfile?.workingHours ?? null,
        stats,
        autoAcceptBookings: Boolean(proProfile?.autoAcceptBookings),

        // ✅ new: management lists (safe, additive)
        management: {
          todaysBookings: todaysBookingsEvents,
          pendingRequests: pendingRequestEvents,
          waitlistToday: waitlistTodayEvents,
          blockedToday: blockedTodayEvents,
        },
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('GET /api/pro/calendar error:', e)
    return NextResponse.json({ error: 'Failed to load pro calendar.' }, { status: 500 })
  }
}
