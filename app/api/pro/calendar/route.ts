// app/api/pro/calendar/route.ts

import {
  BookingStatus,
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'

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

import { overlapMinutes } from '@/lib/calendar/overlap'

import {
  CALENDAR_MS_PER_DAY,
  DEFAULT_BLOCK_CLIENT_NAME,
  DEFAULT_BLOCK_TITLE,
  DEFAULT_BOOKING_CLIENT_NAME,
  DEFAULT_BOOKING_SERVICE_NAME,
  DEFAULT_CALENDAR_RANGE_DAYS,
  MAX_CALENDAR_EVENTS_PER_RANGE,
  MAX_CALENDAR_LOCATIONS_PER_PRO,
  MAX_CALENDAR_RANGE_DAYS,
  roundedCalendarHours,
} from '@/lib/calendar/constants'
export const dynamic = 'force-dynamic'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarRouteErrorCode =
  | 'PRO_PROFILE_NOT_FOUND'
  | 'LOCATION_REQUIRED'
  | 'LOCATION_NOT_FOUND'
  | 'INVALID_RANGE'
  | 'INTERNAL_ERROR'

type CalendarServiceItem = {
  id: string
  name: string | null
  durationMinutes: number
  price: string | null
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
  details: {
    note: string | null
  }
}

type CalendarEvent = BookingEvent | BlockEvent

type CalendarStats = {
  todaysBookings: number
  availableHours: number | null
  pendingRequests: number
  blockedHours: number
}

type CalendarRangeResult =
  | {
      ok: true
      from: Date
      requestedToExclusive: Date
      effectiveToExclusive: Date
      wasClamped: boolean
    }
  | {
      ok: false
      status: number
      code: CalendarRouteErrorCode
      message: string
    }

type SelectedLocationResult =
  | {
      ok: true
      location: ProfessionalLocationRow
    }
  | {
      ok: false
      status: number
      code: CalendarRouteErrorCode
      message: string
    }

type ViewportTimeZoneResult = {
  viewportTimeZone: string
  selectedLocationTimeZoneRaw: string | null
  selectedLocationTimeZoneValid: boolean
  needsTimeZoneSetup: boolean
}


// ─── Prisma selects ───────────────────────────────────────────────────────────

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

// ─── Date / number helpers ────────────────────────────────────────────────────

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * CALENDAR_MS_PER_DAY)
}

function dateMs(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()

  return Number.isFinite(ms) ? ms : Number.NaN
}

function toDateOrNull(value: string | null): Date | null {
  const raw = typeof value === 'string' ? value.trim() : ''

  if (!raw) return null

  const parsed = new Date(raw)

  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function blockOverlapMinutesForRange(args: {
  block: BlockEvent
  rangeStart: Date
  rangeEnd: Date
}): number {
  return overlapMinutes(
    {
      startsAt: args.block.startsAt,
      endsAt: args.block.endsAt,
    },
    {
      startsAt: args.rangeStart,
      endsAt: args.rangeEnd,
    },
  )
}

// ─── Location / timezone helpers ──────────────────────────────────────────────

function supportsSalon(type: ProfessionalLocationType): boolean {
  return (
    type === ProfessionalLocationType.SALON ||
    type === ProfessionalLocationType.SUITE
  )
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

function safeEventTimeZone(value: string | null | undefined): string {
  const sanitized = sanitizeTimeZone(value ?? 'UTC', 'UTC')

  return isValidIanaTimeZone(sanitized) ? sanitized : 'UTC'
}

function validTimeZoneOrNull(value: string | null | undefined): string | null {
  const candidate = typeof value === 'string' ? value.trim() : ''

  if (!candidate) return null
  if (!isValidIanaTimeZone(candidate)) return null

  return candidate
}

function getViewportTimeZone(args: {
  selectedLocation: ProfessionalLocationRow
  profile: ProfessionalProfileRow
}): ViewportTimeZoneResult {
  const selectedLocationTimeZoneRaw =
    typeof args.selectedLocation.timeZone === 'string' &&
    args.selectedLocation.timeZone.trim()
      ? args.selectedLocation.timeZone.trim()
      : null

  const selectedLocationTimeZone = validTimeZoneOrNull(
    selectedLocationTimeZoneRaw,
  )

  const profileTimeZone = validTimeZoneOrNull(args.profile.timeZone)

  const viewportTimeZone = sanitizeTimeZone(
    selectedLocationTimeZone ?? profileTimeZone ?? 'UTC',
    'UTC',
  )

  return {
    viewportTimeZone,
    selectedLocationTimeZoneRaw,
    selectedLocationTimeZoneValid: selectedLocationTimeZone !== null,
    needsTimeZoneSetup:
      selectedLocationTimeZone === null && profileTimeZone === null,
  }
}

function getSelectedLocation(args: {
  locations: ProfessionalLocationRow[]
  requestedLocationId: string
}): SelectedLocationResult {
  const { locations, requestedLocationId } = args

  if (!locations.length) {
    return {
      ok: false,
      status: 409,
      code: 'LOCATION_REQUIRED',
      message: 'Add a bookable location to use the calendar.',
    }
  }

  if (requestedLocationId) {
    const requested = locations.find(
      (location) => location.id === requestedLocationId,
    )

    if (!requested) {
      return {
        ok: false,
        status: 404,
        code: 'LOCATION_NOT_FOUND',
        message: 'Selected location not found.',
      }
    }

    return {
      ok: true,
      location: requested,
    }
  }

  const selected =
    locations.find((location) => location.isPrimary) ?? locations[0]

  if (!selected) {
    return {
      ok: false,
      status: 409,
      code: 'LOCATION_REQUIRED',
      message: 'Add a bookable location to use the calendar.',
    }
  }

  return {
    ok: true,
    location: selected,
  }
}

// ─── Range helpers ────────────────────────────────────────────────────────────

function getCalendarRange(args: {
  url: URL
  now: Date
  viewportTimeZone: string
}): CalendarRangeResult {
  const defaultFrom = startOfDayUtcInTimeZone(
    args.now,
    args.viewportTimeZone,
  )

  const from = toDateOrNull(args.url.searchParams.get('from')) ?? defaultFrom
  const defaultToExclusive = addDaysUtc(from, DEFAULT_CALENDAR_RANGE_DAYS)

  const requestedToExclusive =
    toDateOrNull(args.url.searchParams.get('to')) ?? defaultToExclusive

  if (requestedToExclusive.getTime() <= from.getTime()) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_RANGE',
      message: '`to` must be after `from`.',
    }
  }

  const maxToExclusive = addDaysUtc(from, MAX_CALENDAR_RANGE_DAYS)

  if (requestedToExclusive.getTime() > maxToExclusive.getTime()) {
    return {
      ok: true,
      from,
      requestedToExclusive,
      effectiveToExclusive: maxToExclusive,
      wasClamped: true,
    }
  }

  return {
    ok: true,
    from,
    requestedToExclusive,
    effectiveToExclusive: requestedToExclusive,
    wasClamped: false,
  }
}

// ─── Event builders ───────────────────────────────────────────────────────────

function getClientName(booking: BookingRow): string {
  const firstName = booking.client?.firstName?.trim() ?? ''
  const lastName = booking.client?.lastName?.trim() ?? ''
  const email = booking.client?.user?.email?.trim() ?? ''

  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim()
  }

  return email || DEFAULT_BOOKING_CLIENT_NAME
}

function getServiceName(booking: BookingRow): string {
  const firstItemName = booking.serviceItems[0]?.service?.name?.trim() ?? ''
  const bookingServiceName = booking.service?.name?.trim() ?? ''

  return firstItemName || bookingServiceName || DEFAULT_BOOKING_SERVICE_NAME
}

function priceSnapshotToString(
  value: Prisma.Decimal | number | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()

    return trimmed || null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null
  }

  return value.toString()
}

function toCalendarServiceItems(booking: BookingRow): CalendarServiceItem[] {
  return booking.serviceItems.map((item) => ({
    id: item.id,
    name: item.service?.name?.trim() || null,
    durationMinutes: clampInt(
      item.durationMinutesSnapshot,
      0,
      0,
      MAX_SLOT_DURATION_MINUTES,
    ),
    price: priceSnapshotToString(item.priceSnapshot),
    sortOrder: item.sortOrder ?? 0,
  }))
}

async function toBookingEvent(args: {
  booking: BookingRow
  professionalId: string
  professionalTimeZone: string | null
  viewportTimeZone: string
}): Promise<BookingEvent | null> {
  const { booking, professionalId, professionalTimeZone, viewportTimeZone } =
    args

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

function toBlockEvent(
  block: CalendarBlockRow,
  viewportTimeZone: string,
): BlockEvent | null {
  const start = new Date(block.startsAt)
  const end = new Date(block.endsAt)

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null
  }

  if (end.getTime() <= start.getTime()) return null

  const title = block.note?.trim() ? block.note.trim() : DEFAULT_BLOCK_TITLE

  return {
    id: `block:${block.id}`,
    blockId: block.id,
    kind: 'BLOCK',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    title,
    clientName: DEFAULT_BLOCK_CLIENT_NAME,
    status: 'BLOCKED',
    note: block.note ?? null,
    locationType: null,
    locationId: block.locationId ?? null,
    durationMinutes: Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    ),
    localDateKey: utcDateToLocalYmd(start, viewportTimeZone),
    details: {
      note: block.note ?? null,
    },
  }
}

// ─── Stats / management helpers ───────────────────────────────────────────────

function isBookingVisibleInTodaysStats(event: BookingEvent): boolean {
  return (
    event.status === BookingStatus.ACCEPTED ||
    event.status === BookingStatus.COMPLETED
  )
}

function isFuturePendingRequest(event: BookingEvent, now: Date): boolean {
  return (
    event.status === BookingStatus.PENDING &&
    dateMs(event.startsAt) >= now.getTime()
  )
}

function blockedMinutesForToday(args: {
  blocks: BlockEvent[]
  todayStart: Date
  tomorrowStart: Date
}): number {
  return args.blocks.reduce(
    (sum, block) =>
      sum +
      blockOverlapMinutesForRange({
        block,
        rangeStart: args.todayStart,
        rangeEnd: args.tomorrowStart,
      }),
    0,
  )
}

function sortCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((first, second) => {
    const firstMs = dateMs(first.startsAt)
    const secondMs = dateMs(second.startsAt)

    if (!Number.isFinite(firstMs) && !Number.isFinite(secondMs)) return 0
    if (!Number.isFinite(firstMs)) return 1
    if (!Number.isFinite(secondMs)) return -1

    return firstMs - secondMs
  })
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const url = new URL(req.url)
    const requestedLocationId = (
      url.searchParams.get('locationId') || ''
    ).trim()

    const [proProfile, locations] = await Promise.all([
      prisma.professionalProfile.findUnique({
        where: {
          id: professionalId,
        },
        select: professionalProfileSelect,
      }),
      prisma.professionalLocation.findMany({
        where: {
          professionalId,
          isBookable: true,
        },
        select: professionalLocationSelect,
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: MAX_CALENDAR_LOCATIONS_PER_PRO,
      }),
    ])

    if (!proProfile) {
      return jsonFail(404, 'Professional profile not found.', {
        code: 'PRO_PROFILE_NOT_FOUND',
      })
    }

    const selectedLocationResult = getSelectedLocation({
      locations,
      requestedLocationId,
    })

    if (!selectedLocationResult.ok) {
      return jsonFail(
        selectedLocationResult.status,
        selectedLocationResult.message,
        {
          code: selectedLocationResult.code,
        },
      )
    }

    const selectedLocation = selectedLocationResult.location
    const canSalon = locations.some((location) => supportsSalon(location.type))
    const canMobile = locations.some((location) =>
      supportsMobile(location.type),
    )

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

    const rangeResult = getCalendarRange({
      url,
      now,
      viewportTimeZone,
    })

    if (!rangeResult.ok) {
      return jsonFail(rangeResult.status, rangeResult.message, {
        code: rangeResult.code,
      })
    }

    const { from, requestedToExclusive, effectiveToExclusive, wasClamped } =
      rangeResult

    const [bookings, blocks] = await Promise.all([
      prisma.booking.findMany({
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
        take: MAX_CALENDAR_EVENTS_PER_RANGE
      }),
      prisma.calendarBlock.findMany({
        where: {
          professionalId,
          startsAt: {
            lt: effectiveToExclusive,
          },
          endsAt: {
            gt: from,
          },
          OR: [{ locationId: selectedLocation.id }, { locationId: null }],
        },
        select: calendarBlockSelect,
        orderBy: {
          startsAt: 'asc',
        },
        take: MAX_CALENDAR_EVENTS_PER_RANGE
      }),
    ])

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

    const events = sortCalendarEvents([...bookingEvents, ...blockEvents])

    const viewportTodayKey = utcDateToLocalYmd(now, viewportTimeZone)
    const viewportTodayStart = startOfDayUtcInTimeZone(now, viewportTimeZone)
    const viewportTomorrowStart = addDaysUtc(viewportTodayStart, 1)

    const todaysBookingsEvents = bookingEvents.filter(
      (event) =>
        event.viewLocalDateKey === viewportTodayKey &&
        isBookingVisibleInTodaysStats(event),
    )

    const pendingRequestEvents = bookingEvents.filter((event) =>
      isFuturePendingRequest(event, now),
    )

    const blockedTodayEvents = blockEvents.filter(
      (event) =>
        blockOverlapMinutesForRange({
          block: event,
          rangeStart: viewportTodayStart,
          rangeEnd: viewportTomorrowStart,
        }) > 0,
    )

    const blockedMinutesToday = blockedMinutesForToday({
      blocks: blockedTodayEvents,
      todayStart: viewportTodayStart,
      tomorrowStart: viewportTomorrowStart,
    })

    const stats: CalendarStats = {
      todaysBookings: todaysBookingsEvents.length,
      availableHours: null,
      pendingRequests: pendingRequestEvents.length,
      blockedHours: roundedCalendarHours(blockedMinutesToday),
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
        range: {
          from: from.toISOString(),
          requestedTo: requestedToExclusive.toISOString(),
          effectiveTo: effectiveToExclusive.toISOString(),
          clamped: wasClamped,
          maxDays: MAX_CALENDAR_RANGE_DAYS,
        },
        events,
        canSalon,
        canMobile,
        stats,
        blockedMinutesToday,
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

    return jsonFail(500, 'Failed to load pro calendar.', {
      code: 'INTERNAL_ERROR',
    })
  }
}