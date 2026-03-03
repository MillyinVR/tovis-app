// app/api/pro/calendar/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isValidIanaTimeZone, sanitizeTimeZone, startOfDayUtcInTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

/**
 * These mirror schema.prisma enums exactly.
 * We keep them local because your Prisma client currently isn't exporting enums cleanly.
 */
const BOOKING_STATUS = ['PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED', 'WAITLIST'] as const
type BookingStatus = (typeof BOOKING_STATUS)[number]

const SERVICE_LOCATION_TYPE = ['SALON', 'MOBILE'] as const
type ServiceLocationType = (typeof SERVICE_LOCATION_TYPE)[number]

const PROFESSIONAL_LOCATION_TYPE = ['SALON', 'SUITE', 'MOBILE_BASE'] as const
type ProfessionalLocationType = (typeof PROFESSIONAL_LOCATION_TYPE)[number]

type EventStatus = BookingStatus | 'UNKNOWN' | 'BLOCKED'
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
  status: BookingEventStatus
  locationType: ServiceLocationType | string // tolerate older data, but normalize in output
  locationId: string
  durationMinutes: number
  details: {
    serviceName: string
    bufferMinutes: number
    serviceItems: CalendarServiceItem[]
  }
}

type BlockEvent = {
  id: string // keep the `block:` prefix so UI helpers like isBlockedEvent/extractBlockId keep working
  blockId: string
  kind: 'BLOCK'
  startsAt: string
  endsAt: string
  title: string
  clientName: 'Personal'
  status: 'BLOCKED'
  note: string | null
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
  const t = Math.trunc(x)
  return Math.min(Math.max(t, min), max)
}

function hoursRounded(minutes: number) {
  const h = minutes / 60
  return Math.round(h * 2) / 2
}

function toDateOrNull(v: unknown) {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function normalizeBookingStatus(status: unknown): BookingEventStatus {
  const s = typeof status === 'string' ? status.toUpperCase() : ''
  if ((BOOKING_STATUS as readonly string[]).includes(s)) return s as BookingStatus
  return 'UNKNOWN'
}

function normalizeServiceLocationType(v: unknown): ServiceLocationType | string {
  const s = typeof v === 'string' ? v.toUpperCase() : ''
  if ((SERVICE_LOCATION_TYPE as readonly string[]).includes(s)) return s as ServiceLocationType
  return typeof v === 'string' ? v : ''
}

function normalizeProfessionalLocationType(v: unknown): ProfessionalLocationType | string {
  const s = typeof v === 'string' ? v.toUpperCase() : ''
  if ((PROFESSIONAL_LOCATION_TYPE as readonly string[]).includes(s)) return s as ProfessionalLocationType
  return typeof v === 'string' ? v : ''
}

function locationSupportsSalon(type: unknown) {
  const t = normalizeProfessionalLocationType(type)
  return t === 'SALON' || t === 'SUITE'
}

function locationSupportsMobile(type: unknown) {
  const t = normalizeProfessionalLocationType(type)
  return t === 'MOBILE_BASE'
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

    // ✅ NEW: locationId scoping (bookings are location-scoped in Prisma)
    const url = new URL(req.url)
    const requestedLocationId = (url.searchParams.get('locationId') || '').trim()

    const locations = await prisma.professionalLocation.findMany({
      where: { professionalId, isBookable: true },
      select: { id: true, type: true, isPrimary: true, timeZone: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      take: 50,
    })

    const selectedLocation =
      (requestedLocationId ? locations.find((l) => l.id === requestedLocationId) : null) ??
      locations.find((l) => l.isPrimary) ??
      locations[0] ??
      null

    if (!selectedLocation) {
      // If you have no locations, you can't have a reliable calendar (timezone, working hours, etc.)
      return jsonFail(409, 'Add a bookable location to use the calendar.')
    }

    const canSalon = locations.some((l) => locationSupportsSalon(l.type))
    const canMobile = locations.some((l) => locationSupportsMobile(l.type))

    // ✅ NEW: timezone should be anchored to the selected location first
    const tzRaw =
      (typeof selectedLocation.timeZone === 'string' && selectedLocation.timeZone.trim()) ||
      (typeof proProfile.timeZone === 'string' && proProfile.timeZone.trim()) ||
      ''

    const tzValid = isValidIanaTimeZone(tzRaw)
    const proTz = sanitizeTimeZone(tzRaw, 'UTC')
    const needsTimeZoneSetup = !tzValid

    const now = new Date()

    const defaultFrom = startOfDayUtcInTimeZone(now, proTz)
    const defaultToExclusive = addDaysUtc(defaultFrom, 90)

    const from = toDateOrNull(url.searchParams.get('from')) ?? defaultFrom
    const toExclusive = toDateOrNull(url.searchParams.get('to')) ?? defaultToExclusive

    // Safety clamp so clients can't request absurd windows
    const maxSpanDays = 370
    const spanDays = Math.ceil((toExclusive.getTime() - from.getTime()) / (24 * 60 * 60_000))
    const safeToExclusive =
      spanDays > maxSpanDays ? new Date(from.getTime() + maxSpanDays * 24 * 60 * 60_000) : toExclusive

    // ✅ NEW: bookings filtered to selectedLocation.id
    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        locationId: selectedLocation.id,
        scheduledFor: { gte: from, lt: safeToExclusive },
        // Use literal enum value (matches schema.prisma), no Prisma enum import needed.
        NOT: { status: 'CANCELLED' },
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

    // ✅ NEW: blocks filtered to selected location OR global blocks
    const blocks = await prisma.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: safeToExclusive },
        endsAt: { gt: from },
        OR: [{ locationId: selectedLocation.id }, { locationId: null }],
      },
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

      const serviceName = firstItemName || String(b.service?.name || '').trim() || 'Appointment'

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
        locationType: normalizeServiceLocationType(b.locationType),
        locationId: String(b.locationId ?? ''),
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
        id: `block:${String(bl.id)}`,
        blockId: String(bl.id),
        kind: 'BLOCK',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        title,
        clientName: 'Personal',
        status: 'BLOCKED',
        note: bl.note ?? null,
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

    const todaysBookingsEvents = bookingEvents.filter(
      (e) => isToday(e.startsAt) && (e.status === 'ACCEPTED' || e.status === 'COMPLETED'),
    )

    const pendingRequestEvents = bookingEvents.filter(
      (e) => e.status === 'PENDING' && new Date(e.startsAt).getTime() >= now.getTime(),
    )

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
        // ✅ NEW: expose selected calendar location for UI + debugging
        location: {
          id: selectedLocation.id,
          type: normalizeProfessionalLocationType(selectedLocation.type),
          timeZone: (typeof selectedLocation.timeZone === 'string' && selectedLocation.timeZone.trim()) || null,
        },

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