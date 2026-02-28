// app/api/pro/calendar/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isValidIanaTimeZone, sanitizeTimeZone, startOfDayUtcInTimeZone } from '@/lib/timeZone'
import { BookingStatus, ProfessionalLocationType, ServiceLocationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type EventStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'WAITLIST' | 'CANCELLED' | 'UNKNOWN' | 'BLOCKED'
type BookingEventStatus = Exclude<EventStatus, 'BLOCKED'>

type CalendarServiceItem = {
  id: string
  name: string | null
  durationMinutes: number
  price: unknown | null
  sortOrder: number
}

type BookingEvent = {
  id: string
  kind: 'BOOKING'
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: Exclude<EventStatus, 'BLOCKED'>
  locationType: ServiceLocationType
  locationId: string
  durationMinutes: number
  details: {
    serviceName: string
    bufferMinutes: number
    serviceItems: CalendarServiceItem[]
  }
}

type BlockEvent = {
  id: string
  kind: 'BLOCK'
  startsAt: string
  endsAt: string
  title: string
  clientName: 'Personal'
  status: 'BLOCKED'
  locationType: null
  locationId: string | null
  durationMinutes: number
  details: { note: string | null }
}

type CalendarEvent = BookingEvent | BlockEvent

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

function addDaysUtc(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function clampInt(n: unknown, fallback: number, min: number, max: number) {
  const x = Number(n)
  if (!Number.isFinite(x)) return fallback
  return Math.min(Math.max(Math.trunc(x), min), max)
}

function hoursRounded(minutes: number) {
  const h = minutes / 60
  return Math.round(h * 2) / 2
}

function locationSupportsSalon(type: ProfessionalLocationType) {
  return type === ProfessionalLocationType.SALON || type === ProfessionalLocationType.SUITE
}

function locationSupportsMobile(type: ProfessionalLocationType) {
  return type === ProfessionalLocationType.MOBILE_BASE
}

function toDateOrNull(v: unknown) {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function normalizeBookingStatus(status: BookingStatus | null | undefined): BookingEventStatus {
  if (status === BookingStatus.PENDING) return 'PENDING'
  if (status === BookingStatus.ACCEPTED) return 'ACCEPTED'
  if (status === BookingStatus.COMPLETED) return 'COMPLETED'
  if (status === BookingStatus.WAITLIST) return 'WAITLIST'
  if (status === BookingStatus.CANCELLED) return 'CANCELLED'
  return 'UNKNOWN'
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const proProfile = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { id: true, timeZone: true, autoAcceptBookings: true },
    })
    if (!proProfile) return jsonFail(404, 'Professional profile not found.')

    const locations = await prisma.professionalLocation.findMany({
      where: { professionalId, isBookable: true },
      select: { id: true, type: true, isPrimary: true, timeZone: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      take: 50,
    })

    const canSalon = locations.some((l) => locationSupportsSalon(l.type))
    const canMobile = locations.some((l) => locationSupportsMobile(l.type))

    const primaryLocTz =
      locations.find((l) => l.isPrimary && typeof l.timeZone === 'string' && l.timeZone.trim())?.timeZone ?? null

    const tzRaw =
      (typeof primaryLocTz === 'string' && primaryLocTz.trim()) ||
      (typeof proProfile.timeZone === 'string' && proProfile.timeZone.trim()) ||
      ''

    const tzValid = isValidIanaTimeZone(tzRaw)
    const proTz = sanitizeTimeZone(tzRaw, 'UTC')
    const needsTimeZoneSetup = !tzValid

    const url = new URL(req.url)
    const now = new Date()

    const defaultFrom = startOfDayUtcInTimeZone(now, proTz)
    const defaultToExclusive = addDaysUtc(defaultFrom, 90)

    const from = toDateOrNull(url.searchParams.get('from')) ?? defaultFrom
    const toExclusive = toDateOrNull(url.searchParams.get('to')) ?? defaultToExclusive

    const maxSpanDays = 370
    const spanDays = Math.ceil((toExclusive.getTime() - from.getTime()) / (24 * 60 * 60_000))
    const safeToExclusive =
      spanDays > maxSpanDays ? new Date(from.getTime() + maxSpanDays * 24 * 60 * 60_000) : toExclusive

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: from, lt: safeToExclusive },
        NOT: { status: BookingStatus.CANCELLED },
      },
      select: {
        id: true,
        scheduledFor: true,
        status: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        locationType: true,
        locationId: true,
        client: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
        service: { select: { name: true } },
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
      },
      orderBy: { scheduledFor: 'asc' },
      take: 1200,
    })

    const blocks = await prisma.calendarBlock.findMany({
      where: { professionalId, startsAt: { lt: safeToExclusive }, endsAt: { gt: from } },
      select: { id: true, startsAt: true, endsAt: true, note: true, locationId: true },
      orderBy: { startsAt: 'asc' },
      take: 1200,
    })

    const bookingEvents: BookingEvent[] = bookings.map((b) => {
      const start = new Date(b.scheduledFor)
      const baseDuration = clampInt(b.totalDurationMinutes, 60, 15, 12 * 60)
      const buffer = clampInt(b.bufferMinutes, 0, 0, 180)
      const end = addMinutes(start, baseDuration + buffer)

      const status = normalizeBookingStatus(b.status)

      const firstItemName =
        Array.isArray(b.serviceItems) && b.serviceItems.length
          ? String(b.serviceItems[0]?.service?.name || '').trim()
          : ''

      const serviceName = firstItemName || b.service?.name || 'Appointment'

      const fn = String(b.client?.firstName || '').trim()
      const ln = String(b.client?.lastName || '').trim()
      const email = String(b.client?.user?.email || '').trim()
      const clientName = fn || ln ? `${fn} ${ln}`.trim() : email || 'Client'

      const serviceItems: CalendarServiceItem[] = Array.isArray(b.serviceItems)
        ? b.serviceItems.map((si) => ({
            id: String(si.id),
            name: String(si.service?.name || '').trim() || null,
            durationMinutes: clampInt(si.durationMinutesSnapshot, 0, 0, 12 * 60),
            price: si.priceSnapshot ?? null,
            sortOrder: Number(si.sortOrder ?? 0),
          }))
        : []

      return {
        id: String(b.id),
        kind: 'BOOKING',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        title: serviceName,
        clientName,
        status,
        locationType: b.locationType, // ✅ strongly typed now
        locationId: b.locationId, // ✅ required by schema
        durationMinutes: baseDuration,
        details: {
          serviceName,
          bufferMinutes: buffer,
          serviceItems,
        },
      }
    })

    const blockEvents: BlockEvent[] = blocks.map((bl) => {
      const start = new Date(bl.startsAt)
      const end = new Date(bl.endsAt)
      const title = bl.note?.trim() ? bl.note.trim() : 'Blocked time'

      return {
        id: `block_${String(bl.id)}`,
        kind: 'BLOCK',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        title,
        clientName: 'Personal',
        status: 'BLOCKED',
        locationType: null,
        locationId: bl.locationId ?? null,
        durationMinutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)),
        details: { note: bl.note ?? null },
      }
    })

    const events: CalendarEvent[] = [...bookingEvents, ...blockEvents].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )

    const todayStart = startOfDayUtcInTimeZone(now, proTz)
    const todayEndExclusive = addDaysUtc(todayStart, 1)

    const isToday = (iso: string) => {
      const t = new Date(iso).getTime()
      return t >= todayStart.getTime() && t < todayEndExclusive.getTime()
    }

    const todaysBookingsEvents = bookingEvents.filter((e) => {
      return isToday(e.startsAt) && (e.status === 'ACCEPTED' || e.status === 'COMPLETED')
    })

    const pendingRequestEvents = bookingEvents.filter((e) => {
      return e.status === 'PENDING' && new Date(e.startsAt).getTime() >= now.getTime()
    })

    const waitlistTodayEvents = bookingEvents.filter((e) => isToday(e.startsAt) && e.status === 'WAITLIST')

    const blockedTodayEvents = blockEvents.filter((e) => isToday(e.startsAt))
    const blockedMinutesToday = blockedTodayEvents.reduce((acc, e) => acc + (e.durationMinutes || 0), 0)

    const stats = {
      todaysBookings: todaysBookingsEvents.length,
      availableHours: null as number | null,
      pendingRequests: pendingRequestEvents.length,
      blockedHours: blockedMinutesToday ? hoursRounded(blockedMinutesToday) : 0,
    }

    return jsonOk(
      {
        timeZone: proTz,
        needsTimeZoneSetup,
        events,
        canSalon,
        canMobile,
        stats,
        autoAcceptBookings: Boolean(proProfile.autoAcceptBookings),
        management: {
          todaysBookings: todaysBookingsEvents,
          pendingRequests: pendingRequestEvents,
          waitlistToday: waitlistTodayEvents,
          blockedToday: blockedTodayEvents,
        },
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/calendar error:', e)
    return jsonFail(500, 'Failed to load pro calendar.')
  }
}
