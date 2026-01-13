// app/api/pro/calendar/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PROFESSIONAL' || r === 'PRO'
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function pickPositiveNumber(v: any, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function hoursRounded(minutes: number) {
  const h = minutes / 60
  return Math.round(h * 2) / 2
}

function isValidIanaTimeZone(tz: string | null | undefined) {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

function dtfPartsInTimeZone(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function timeZoneOffsetMinutes(at: Date, timeZone: string) {
  const p = dtfPartsInTimeZone(at, timeZone)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const offsetMs = asIfUtc - at.getTime()
  return Math.round(offsetMs / 60_000)
}

function zonedToUtc(
  args: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
) {
  const { year, month, day, hour, minute } = args
  const second = args.second ?? 0

  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  for (let i = 0; i < 4; i++) {
    const off = timeZoneOffsetMinutes(guess, timeZone)
    const corrected = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - off * 60_000)
    if (Math.abs(corrected.getTime() - guess.getTime()) < 500) return corrected
    guess = corrected
  }
  return guess
}

function startOfDayUtcInTimeZone(date: Date, timeZone: string) {
  const p = dtfPartsInTimeZone(date, timeZone)
  return zonedToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 }, timeZone)
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

    const proProfile = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        workingHours: true,
        autoAcceptBookings: true,
        timeZone: true,
      },
    })

    if (!proProfile) {
      return NextResponse.json({ error: 'Professional profile not found.' }, { status: 404 })
    }

    // ✅ Use DB timezone if valid; otherwise fall back to UTC *and* tell UI to prompt setup
    const tzRaw = typeof proProfile.timeZone === 'string' ? proProfile.timeZone.trim() : ''
    const tzValid = isValidIanaTimeZone(tzRaw)
    const proTz = tzValid ? tzRaw : 'UTC'
    const needsTimeZoneSetup = !tzValid

    // Window: start of "today" in pro timezone (or UTC fallback) -> +60 days
    const now = new Date()
    const from = startOfDayUtcInTimeZone(now, proTz)
    const toExclusive = addDaysUtc(from, 60)

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: from, lt: toExclusive },
        NOT: { status: 'CANCELLED' as any },
      },
      select: {
        id: true,
        scheduledFor: true,
        status: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        durationMinutesSnapshot: true,

        client: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },

        // Keep this for fallback
        service: { select: { name: true } },

        // ✅ Requested service truth: serviceItems
        serviceItems: {
          select: {
            id: true,
            sortOrder: true,
            durationMinutesSnapshot: true,
            priceSnapshot: true,
            service: { select: { name: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
      } as any,
      orderBy: { scheduledFor: 'asc' },
      take: 500,
    })

    const events = bookings.map((b: any) => {
      const start = new Date(b.scheduledFor)

      const baseDuration = pickPositiveNumber(
        b.totalDurationMinutes,
        pickPositiveNumber(b.durationMinutesSnapshot, 60),
      )

      const buffer = pickPositiveNumber(b.bufferMinutes, 0)
      const end = addMinutes(start, baseDuration + buffer)

      const status = String(b.status || '').toUpperCase()

      const firstItemName =
        Array.isArray(b.serviceItems) && b.serviceItems.length
          ? String(b.serviceItems[0]?.service?.name || '').trim()
          : ''

      const serviceName =
        status === 'BLOCKED'
          ? 'Blocked time'
          : status === 'WAITLIST'
            ? 'Waitlist'
            : firstItemName || b.service?.name || 'Appointment'

      const fn = String(b.client?.firstName || '').trim()
      const ln = String(b.client?.lastName || '').trim()
      const email = String(b.client?.user?.email || '').trim()

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
        durationMinutes: baseDuration, // without buffer

        // Optional: expose details so click view can show it reliably
        details: {
          serviceName,
          serviceItems: Array.isArray(b.serviceItems)
            ? b.serviceItems.map((si: any) => ({
                id: String(si.id),
                name: String(si.service?.name || '').trim() || null,
                durationMinutes: pickPositiveNumber(si.durationMinutesSnapshot, 0),
                price: si.priceSnapshot ?? null,
                sortOrder: Number(si.sortOrder ?? 0),
              }))
            : [],
        },
      }
    })

    // "Today" boundaries in pro timezone (or UTC fallback)
    const todayStart = startOfDayUtcInTimeZone(now, proTz)
    const todayEndExclusive = addDaysUtc(todayStart, 1)

    const isToday = (iso: string) => {
      const t = new Date(iso).getTime()
      return t >= todayStart.getTime() && t < todayEndExclusive.getTime()
    }

    const todaysBookingsEvents = events.filter((e: any) => {
      const s = String(e.status || '').toUpperCase()
      return isToday(e.startsAt) && (s === 'ACCEPTED' || s === 'COMPLETED')
    })

    const pendingRequestEvents = events.filter((e: any) => {
      const s = String(e.status || '').toUpperCase()
      if (s !== 'PENDING') return false
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
      todaysBookings: todaysBookingsEvents.length,
      availableHours: null,
      pendingRequests: pendingRequestEvents.length,
      blockedHours: blockedMinutesToday ? hoursRounded(blockedMinutesToday) : 0,
    }

    return NextResponse.json(
      {
        ok: true,
        timeZone: proTz,
        needsTimeZoneSetup,
        events,
        workingHours: proProfile.workingHours ?? null,
        stats,
        autoAcceptBookings: Boolean(proProfile.autoAcceptBookings),
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
