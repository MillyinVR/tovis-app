// app/api/pro/calendar/route.ts
import { Prisma, BookingStatus, ProfessionalLocationType, ServiceLocationType } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_BUFFER_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes } from '@/lib/booking/conflicts'
import { utcDateToLocalYmd } from '@/lib/booking/dateTime'
import {
  resolveAppointmentSchedulingContext,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import { clampInt } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import {
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type CalendarServiceItem = {
  id: string
  name: string | null
  durationMinutes: number
  price: Prisma.Decimal | number | string | null | unknown
  sortOrder: number
}

type BookingEvent = {
  id: string
  kind: 'BOOKING'
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: BookingStatus
  locationType: ServiceLocationType | null
  locationId: string
  durationMinutes: number
  timeZone: string
  timeZoneSource: TimeZoneTruthSource
  localDateKey: string
  viewLocalDateKey: string
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
  localDateKey: string
  details: { note: string | null }
}

type CalendarEvent = BookingEvent | BlockEvent

type CalendarStats = {
  todaysBookings: number
  availableHours: number | null
  pendingRequests: number
  blockedHours: number
}

const professionalProfileSelect = {
  id: true,
  timeZone: true,
  autoAcceptBookings: true,
} satisfies Prisma.ProfessionalProfileSelect

const professionalLocationSelect = {
  id: true,
  type: true,
  isPrimary: true,
  timeZone: true,
  createdAt: true,
} satisfies Prisma.ProfessionalLocationSelect

const bookingSelect = {
  id: true,
  scheduledFor: true,
  status: true,
  totalDurationMinutes: true,
  bufferMinutes: true,
  locationType: true,
  locationId: true,
  locationTimeZone: true,
  client: {
    select: {
      firstName: true,
      lastName: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  },
  service: {
    select: {
      name: true,
    },
  },
  location: {
    select: {
      id: true,
      timeZone: true,
    },
  },
  serviceItems: {
    select: {
      id: true,
      sortOrder: true,
      durationMinutesSnapshot: true,
      priceSnapshot: true,
      service: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      sortOrder: 'asc',
    },
  },
} satisfies Prisma.BookingSelect

const calendarBlockSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  note: true,
  locationId: true,
} satisfies Prisma.CalendarBlockSelect

type ProfessionalProfileRow = Prisma.ProfessionalProfileGetPayload<{
  select: typeof professionalProfileSelect
}>

type ProfessionalLocationRow = Prisma.ProfessionalLocationGetPayload<{
  select: typeof professionalLocationSelect
}>

type BookingRow = Prisma.BookingGetPayload<{
  select: typeof bookingSelect
}>

type CalendarBlockRow = Prisma.CalendarBlockGetPayload<{
  select: typeof calendarBlockSelect
}>

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function hoursRounded(minutes: number): number {
  const hours = minutes / 60
  return Math.round(hours * 2) / 2
}

function toDateOrNull(value: string | null): Date | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function supportsSalon(type: ProfessionalLocationType): boolean {
  return type === ProfessionalLocationType.SALON || type === ProfessionalLocationType.SUITE
}

function supportsMobile(type: ProfessionalLocationType): boolean {
  return type === ProfessionalLocationType.MOBILE_BASE
}

function safeDurationMinutes(value: number | null | undefined): number {
  return clampInt(value, DEFAULT_DURATION_MINUTES, 15, MAX_SLOT_DURATION_MINUTES)
}

function safeBufferMinutes(value: number | null | undefined): number {
  return clampInt(value, 0, 0, MAX_BUFFER_MINUTES)
}

function safeEventTimeZone(value: string): string {
  const sanitized = sanitizeTimeZone(value, 'UTC')
  return isValidIanaTimeZone(sanitized) ? sanitized : 'UTC'
}

function getViewportTimeZone(args: {
  selectedLocation: ProfessionalLocationRow
  profile: ProfessionalProfileRow
}): {
  viewportTimeZone: string
  selectedLocationTimeZoneRaw: string | null
  selectedLocationTimeZoneValid: boolean
  needsTimeZoneSetup: boolean
} {
  const selectedLocationTimeZoneRaw =
    typeof args.selectedLocation.timeZone === 'string' && args.selectedLocation.timeZone.trim()
      ? args.selectedLocation.timeZone.trim()
      : null

  const profileTimeZoneRaw =
    typeof args.profile.timeZone === 'string' && args.profile.timeZone.trim()
      ? args.profile.timeZone.trim()
      : null

  const selectedLocationTimeZoneValid = Boolean(
    selectedLocationTimeZoneRaw && isValidIanaTimeZone(selectedLocationTimeZoneRaw),
  )
  const profileTimeZoneValid = Boolean(profileTimeZoneRaw && isValidIanaTimeZone(profileTimeZoneRaw))

  const viewportTimeZone = sanitizeTimeZone(
    selectedLocationTimeZoneValid
      ? selectedLocationTimeZoneRaw
      : profileTimeZoneValid
        ? profileTimeZoneRaw
        : 'UTC',
    'UTC',
  )

  return {
    viewportTimeZone,
    selectedLocationTimeZoneRaw,
    selectedLocationTimeZoneValid,
    needsTimeZoneSetup: !selectedLocationTimeZoneValid && !profileTimeZoneValid,
  }
}

function getSelectedLocation(args: {
  locations: ProfessionalLocationRow[]
  requestedLocationId: string
}): { ok: true; location: ProfessionalLocationRow } | { ok: false; status: number; message: string } {
  const { locations, requestedLocationId } = args

  if (!locations.length) {
    return { ok: false, status: 409, message: 'Add a bookable location to use the calendar.' }
  }

  if (requestedLocationId) {
    const requested = locations.find((location) => location.id === requestedLocationId)
    if (!requested) {
      return { ok: false, status: 404, message: 'Selected location not found.' }
    }
    return { ok: true, location: requested }
  }

  const selected =
    locations.find((location) => location.isPrimary) ??
    locations[0]

  if (!selected) {
    return { ok: false, status: 409, message: 'Add a bookable location to use the calendar.' }
  }

  return { ok: true, location: selected }
}

function getClientName(booking: BookingRow): string {
  const firstName = booking.client?.firstName?.trim() ?? ''
  const lastName = booking.client?.lastName?.trim() ?? ''
  const email = booking.client?.user?.email?.trim() ?? ''

  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim()
  }

  return email || 'Client'
}

function getServiceName(booking: BookingRow): string {
  const firstItemName = booking.serviceItems[0]?.service?.name?.trim() ?? ''
  const bookingServiceName = booking.service?.name?.trim() ?? ''
  return firstItemName || bookingServiceName || 'Appointment'
}

function toCalendarServiceItems(booking: BookingRow): CalendarServiceItem[] {
  return booking.serviceItems.map((item) => ({
    id: item.id,
    name: item.service?.name?.trim() || null,
    durationMinutes: clampInt(item.durationMinutesSnapshot, 0, 0, MAX_SLOT_DURATION_MINUTES),
    price: item.priceSnapshot ?? null,
    sortOrder: item.sortOrder ?? 0,
  }))
}

async function toBookingEvent(args: {
  booking: BookingRow
  professionalId: string
  professionalTimeZone: string | null
  viewportTimeZone: string
}): Promise<BookingEvent | null> {
  const { booking, professionalId, professionalTimeZone, viewportTimeZone } = args

  if (!booking.locationId) return null

  const start = new Date(booking.scheduledFor)
  if (!Number.isFinite(start.getTime())) return null

  const durationMinutes = safeDurationMinutes(booking.totalDurationMinutes)
  const bufferMinutes = safeBufferMinutes(booking.bufferMinutes)
  const end = addMinutes(start, durationMinutes + bufferMinutes)

  const schedulingContextResult = await resolveAppointmentSchedulingContext({
    bookingLocationTimeZone: booking.locationTimeZone,
    location: booking.location
      ? {
          id: booking.location.id,
          timeZone: booking.location.timeZone,
        }
      : null,
    locationId: booking.locationId,
    professionalId,
    professionalTimeZone,
    fallback: 'UTC',
    requireValid: false,
  })

  const appointmentTimeZone = schedulingContextResult.ok
    ? safeEventTimeZone(schedulingContextResult.context.appointmentTimeZone)
    : 'UTC'

  const timeZoneSource: TimeZoneTruthSource = schedulingContextResult.ok
    ? schedulingContextResult.context.timeZoneSource
    : 'FALLBACK'

  const localDateKey = utcDateToLocalYmd(start, appointmentTimeZone)
  const viewLocalDateKey = utcDateToLocalYmd(start, viewportTimeZone)
  const serviceName = getServiceName(booking)

  return {
    id: booking.id,
    kind: 'BOOKING',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    title: serviceName,
    clientName: getClientName(booking),
    status: booking.status,
    locationType: booking.locationType,
    locationId: booking.locationId,
    durationMinutes,
    timeZone: appointmentTimeZone,
    timeZoneSource,
    localDateKey,
    viewLocalDateKey,
    details: {
      serviceName,
      bufferMinutes,
      serviceItems: toCalendarServiceItems(booking),
    },
  }
}

function toBlockEvent(block: CalendarBlockRow, viewportTimeZone: string): BlockEvent | null {
  const start = new Date(block.startsAt)
  const end = new Date(block.endsAt)

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null
  }

  const title = block.note?.trim() ? block.note.trim() : 'Blocked time'

  return {
    id: `block:${block.id}`,
    blockId: block.id,
    kind: 'BLOCK',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    title,
    clientName: 'Personal',
    status: 'BLOCKED',
    note: block.note ?? null,
    locationType: null,
    locationId: block.locationId ?? null,
    durationMinutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)),
    localDateKey: utcDateToLocalYmd(start, viewportTimeZone),
    details: {
      note: block.note ?? null,
    },
  }
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
      select: professionalProfileSelect,
    })

    if (!proProfile) {
      return jsonFail(404, 'Professional profile not found.')
    }

    const locations = await prisma.professionalLocation.findMany({
      where: {
        professionalId,
        isBookable: true,
      },
      select: professionalLocationSelect,
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      take: 50,
    })

    const selectedLocationResult = getSelectedLocation({
      locations,
      requestedLocationId,
    })

    if (!selectedLocationResult.ok) {
      return jsonFail(selectedLocationResult.status, selectedLocationResult.message)
    }

    const selectedLocation = selectedLocationResult.location

    const canSalon = locations.some((location) => supportsSalon(location.type))
    const canMobile = locations.some((location) => supportsMobile(location.type))

    const {
      viewportTimeZone,
      selectedLocationTimeZoneRaw,
      selectedLocationTimeZoneValid,
      needsTimeZoneSetup,
    } = getViewportTimeZone({
      selectedLocation,
      profile: proProfile,
    })

    const now = new Date()
    const defaultFrom = startOfDayUtcInTimeZone(now, viewportTimeZone)
    const defaultToExclusive = addDaysUtc(defaultFrom, 90)

    const from = toDateOrNull(url.searchParams.get('from')) ?? defaultFrom
    const requestedToExclusive = toDateOrNull(url.searchParams.get('to')) ?? defaultToExclusive

    if (requestedToExclusive.getTime() <= from.getTime()) {
      return jsonFail(400, '`to` must be after `from`.')
    }

    const maxSpanDays = 370
    const maxToExclusive = addDaysUtc(from, maxSpanDays)
    const effectiveToExclusive =
      requestedToExclusive.getTime() > maxToExclusive.getTime()
        ? maxToExclusive
        : requestedToExclusive

    const bookings = await prisma.booking.findMany({
      where: {
        professionalId,
        locationId: selectedLocation.id,
        scheduledFor: {
          gte: from,
          lt: effectiveToExclusive,
        },
        NOT: {
          status: BookingStatus.CANCELLED,
        },
      },
      select: bookingSelect,
      orderBy: {
        scheduledFor: 'asc',
      },
      take: 1200,
    })

    const blocks = await prisma.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: effectiveToExclusive },
        endsAt: { gt: from },
        OR: [{ locationId: selectedLocation.id }, { locationId: null }],
      },
      select: calendarBlockSelect,
      orderBy: {
        startsAt: 'asc',
      },
      take: 1200,
    })

    const bookingEventsMaybe = await Promise.all(
      bookings.map((booking) =>
        toBookingEvent({
          booking,
          professionalId,
          professionalTimeZone: proProfile.timeZone,
          viewportTimeZone,
        }),
      ),
    )

    const bookingEvents = bookingEventsMaybe.filter(
      (event): event is BookingEvent => event !== null,
    )

    const blockEvents = blocks
      .map((block) => toBlockEvent(block, viewportTimeZone))
      .filter((event): event is BlockEvent => event !== null)

    const events: CalendarEvent[] = [...bookingEvents, ...blockEvents].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )

    const viewportTodayKey = utcDateToLocalYmd(now, viewportTimeZone)

    const todaysBookingsEvents = bookingEvents.filter(
      (event) =>
        event.viewLocalDateKey === viewportTodayKey &&
        (event.status === BookingStatus.ACCEPTED ||
          event.status === BookingStatus.COMPLETED),
    )

    const pendingRequestEvents = bookingEvents.filter(
      (event) =>
        event.status === BookingStatus.PENDING &&
        new Date(event.startsAt).getTime() >= now.getTime(),
    )

    const blockedTodayEvents = blockEvents.filter(
      (event) => event.localDateKey === viewportTodayKey,
    )

    const blockedMinutesToday = blockedTodayEvents.reduce(
      (sum, event) => sum + event.durationMinutes,
      0,
    )

    const stats: CalendarStats = {
      todaysBookings: todaysBookingsEvents.length,
      availableHours: null,
      pendingRequests: pendingRequestEvents.length,
      blockedHours: blockedMinutesToday ? hoursRounded(blockedMinutesToday) : 0,
    }

    return jsonOk(
      {
        location: {
          id: selectedLocation.id,
          type: selectedLocation.type,
          timeZone: selectedLocationTimeZoneRaw,
          timeZoneValid: selectedLocationTimeZoneValid,
        },
        timeZone: viewportTimeZone,
        viewportTimeZone,
        needsTimeZoneSetup,
        events,
        canSalon,
        canMobile,
        stats,
        autoAcceptBookings: Boolean(proProfile.autoAcceptBookings),
        management: {
          todaysBookings: todaysBookingsEvents,
          pendingRequests: pendingRequestEvents,
          waitlistToday: [],
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