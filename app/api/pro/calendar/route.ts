// app/api/pro/calendar/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { clampInt } from '@/lib/pick'
import {
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from '@/lib/timeZone'
import { addMinutes } from '@/lib/booking/conflicts'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'

export const dynamic = 'force-dynamic'

type BookingStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'WAITLIST'

type ServiceLocationType = 'SALON' | 'MOBILE'
type ProfessionalLocationType = 'SALON' | 'SUITE' | 'MOBILE_BASE'

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
  locationType: ServiceLocationType | string
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

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function hoursRounded(minutes: number): number {
  const hours = minutes / 60
  return Math.round(hours * 2) / 2
}

function toDateOrNull(value: unknown): Date | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function normalizeBookingStatus(status: unknown): BookingEventStatus {
  const raw = typeof status === 'string' ? status.trim().toUpperCase() : ''

  if (
    raw === 'PENDING' ||
    raw === 'ACCEPTED' ||
    raw === 'COMPLETED' ||
    raw === 'CANCELLED' ||
    raw === 'WAITLIST'
  ) {
    return raw
  }

  return 'UNKNOWN'
}

function normalizeServiceLocationType(value: unknown): ServiceLocationType | string {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (raw === 'SALON' || raw === 'MOBILE') {
    return raw
  }

  return typeof value === 'string' ? value : ''
}

function normalizeProfessionalLocationType(
  value: unknown,
): ProfessionalLocationType | string {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (raw === 'SALON' || raw === 'SUITE' || raw === 'MOBILE_BASE') {
    return raw
  }

  return typeof value === 'string' ? value : ''
}

function locationSupportsSalon(type: unknown): boolean {
  const normalized = normalizeProfessionalLocationType(type)
  return normalized === 'SALON' || normalized === 'SUITE'
}

function locationSupportsMobile(type: unknown): boolean {
  return normalizeProfessionalLocationType(type) === 'MOBILE_BASE'
}

function safeDurationMinutes(value: unknown): number {
  return clampInt(
    value,
    DEFAULT_DURATION_MINUTES,
    15,
    MAX_SLOT_DURATION_MINUTES,
  )
}

function safeBufferMinutes(value: unknown): number {
  return clampInt(value, 0, 0, MAX_BUFFER_MINUTES)
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const url = new URL(req.url)
    const requestedLocationId = (url.searchParams.get('locationId') || '').trim()

    const proProfile = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        id: true,
        timeZone: true,
        autoAcceptBookings: true,
      },
    })

    if (!proProfile) {
      return jsonFail(404, 'Professional profile not found.')
    }

    const locations = await prisma.professionalLocation.findMany({
      where: {
        professionalId,
        isBookable: true,
      },
      select: {
        id: true,
        type: true,
        isPrimary: true,
        timeZone: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      take: 50,
    })

    if (!locations.length) {
      return jsonFail(409, 'Add a bookable location to use the calendar.')
    }

    const explicitlyRequestedLocation = requestedLocationId
      ? locations.find((location) => location.id === requestedLocationId) ?? null
      : null

    if (requestedLocationId && !explicitlyRequestedLocation) {
      return jsonFail(404, 'Selected location not found.')
    }

    const selectedLocation =
      explicitlyRequestedLocation ??
      locations.find((location) => location.isPrimary) ??
      locations[0] ??
      null

    if (!selectedLocation) {
      return jsonFail(409, 'Add a bookable location to use the calendar.')
    }

    const canSalon = locations.some((location) => locationSupportsSalon(location.type))
    const canMobile = locations.some((location) => locationSupportsMobile(location.type))

    const locationTimeZoneRaw =
      typeof selectedLocation.timeZone === 'string'
        ? selectedLocation.timeZone.trim()
        : ''

    const profileTimeZoneRaw =
      typeof proProfile.timeZone === 'string'
        ? proProfile.timeZone.trim()
        : ''

    const selectedLocationTimeZoneValid = isValidIanaTimeZone(locationTimeZoneRaw)
    const profileTimeZoneValid = isValidIanaTimeZone(profileTimeZoneRaw)

    const calendarTimeZone = sanitizeTimeZone(
      selectedLocationTimeZoneValid
        ? locationTimeZoneRaw
        : profileTimeZoneValid
          ? profileTimeZoneRaw
          : 'UTC',
      'UTC',
    )

    const needsTimeZoneSetup =
      !selectedLocationTimeZoneValid && !profileTimeZoneValid

    const now = new Date()
    const defaultFrom = startOfDayUtcInTimeZone(now, calendarTimeZone)
    const defaultToExclusive = addDaysUtc(defaultFrom, 90)

    const from = toDateOrNull(url.searchParams.get('from')) ?? defaultFrom
    const requestedToExclusive =
      toDateOrNull(url.searchParams.get('to')) ?? defaultToExclusive

    if (requestedToExclusive.getTime() <= from.getTime()) {
      return jsonFail(400, '`to` must be after `from`.')
    }

    const maxSpanDays = 370
    const maxToExclusive = new Date(
      from.getTime() + maxSpanDays * 24 * 60 * 60_000,
    )

    const effectiveToExclusive =
      requestedToExclusive.getTime() > maxToExclusive.getTime()
        ? maxToExclusive
        : requestedToExclusive

    // All bookings for the pro stay visible in the pro calendar,
    // regardless of location/mode, so cross-location occupancy is obvious.
    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: from, lt: effectiveToExclusive },
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
        client: {
          select: {
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },
        service: {
          select: { name: true },
        },
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

    // Blocks are scoped to the selected location or global blocks.
    const blocks = await prisma.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: effectiveToExclusive },
        endsAt: { gt: from },
        OR: [{ locationId: selectedLocation.id }, { locationId: null }],
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        note: true,
        locationId: true,
      },
      orderBy: { startsAt: 'asc' },
      take: 1200,
    })

    const bookingEvents: BookingEvent[] = bookings.flatMap((booking) => {
      if (!booking.locationId) return []

      const start = new Date(booking.scheduledFor)
      const durationMinutes = safeDurationMinutes(booking.totalDurationMinutes)
      const bufferMinutes = safeBufferMinutes(booking.bufferMinutes)
      const end = addMinutes(start, durationMinutes + bufferMinutes)

      const firstItemName =
        booking.serviceItems.length > 0
          ? String(booking.serviceItems[0]?.service?.name || '').trim()
          : ''

      const serviceName =
        firstItemName ||
        String(booking.service?.name || '').trim() ||
        'Appointment'

      const firstName = String(booking.client?.firstName || '').trim()
      const lastName = String(booking.client?.lastName || '').trim()
      const email = String(booking.client?.user?.email || '').trim()

      const clientName =
        firstName || lastName
          ? `${firstName} ${lastName}`.trim()
          : email || 'Client'

      const serviceItems: CalendarServiceItem[] = booking.serviceItems.map((item) => ({
        id: String(item.id),
        name: String(item.service?.name || '').trim() || null,
        durationMinutes: clampInt(
          item.durationMinutesSnapshot,
          0,
          0,
          MAX_SLOT_DURATION_MINUTES,
        ),
        price: item.priceSnapshot ?? null,
        sortOrder: Number(item.sortOrder ?? 0),
      }))

      return [
        {
          id: String(booking.id),
          kind: 'BOOKING' as const,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          title: serviceName,
          clientName,
          status: normalizeBookingStatus(booking.status),
          locationType: normalizeServiceLocationType(booking.locationType),
          locationId: booking.locationId,
          durationMinutes,
          details: {
            serviceName,
            bufferMinutes,
            serviceItems,
          },
        },
      ]
    })

    const blockEvents: BlockEvent[] = blocks.map((block) => {
      const start = new Date(block.startsAt)
      const end = new Date(block.endsAt)
      const title = block.note?.trim() ? block.note.trim() : 'Blocked time'

      return {
        id: `block:${String(block.id)}`,
        blockId: String(block.id),
        kind: 'BLOCK',
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        title,
        clientName: 'Personal',
        status: 'BLOCKED',
        note: block.note ?? null,
        locationType: null,
        locationId: block.locationId ?? null,
        durationMinutes: Math.max(
          0,
          Math.round((end.getTime() - start.getTime()) / 60_000),
        ),
        details: {
          note: block.note ?? null,
        },
      }
    })

    const events: CalendarEvent[] = [...bookingEvents, ...blockEvents].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )

    const todayStart = startOfDayUtcInTimeZone(now, calendarTimeZone)
    const todayEndExclusive = addDaysUtc(todayStart, 1)

    const isToday = (iso: string) => {
      const time = new Date(iso).getTime()
      return time >= todayStart.getTime() && time < todayEndExclusive.getTime()
    }

    const todaysBookingsEvents = bookingEvents.filter(
      (event) =>
        isToday(event.startsAt) &&
        (event.status === 'ACCEPTED' || event.status === 'COMPLETED'),
    )

    const pendingRequestEvents = bookingEvents.filter(
      (event) =>
        event.status === 'PENDING' &&
        new Date(event.startsAt).getTime() >= now.getTime(),
    )

    const waitlistTodayEvents = bookingEvents.filter(
      (event) => isToday(event.startsAt) && event.status === 'WAITLIST',
    )

    const blockedTodayEvents = blockEvents.filter((event) => isToday(event.startsAt))
    const blockedMinutesToday = blockedTodayEvents.reduce(
      (sum, event) => sum + event.durationMinutes,
      0,
    )

    const stats = {
      todaysBookings: todaysBookingsEvents.length,
      availableHours: null as number | null,
      pendingRequests: pendingRequestEvents.length,
      blockedHours: blockedMinutesToday ? hoursRounded(blockedMinutesToday) : 0,
    }

    return jsonOk(
      {
        location: {
          id: selectedLocation.id,
          type: normalizeProfessionalLocationType(selectedLocation.type),
          timeZone: locationTimeZoneRaw || null,
          timeZoneValid: selectedLocationTimeZoneValid,
        },
        timeZone: calendarTimeZone,
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
  } catch (error) {
    console.error('GET /api/pro/calendar error:', error)
    return jsonFail(500, 'Failed to load pro calendar.')
  }
}