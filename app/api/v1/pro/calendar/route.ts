// app/api/v1/pro/calendar/route.ts

import {
  BookingStatus,
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
  WaitlistOfferStatus,
  WaitlistStatus,
} from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { getVisibleClientIdSetForPro } from '@/lib/clientVisibility'
import { formatWaitlistPreferenceLabel } from '@/lib/waitlist/preferenceLabel'
import {
  DEFAULT_DURATION_MINUTES,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { addMinutes } from '@/lib/booking/conflicts'
import { formatBookingServicesLabel } from '@/lib/booking/serviceLabel'
import { utcDateToLocalYmd } from '@/lib/booking/dateTime'
import {
  resolveApptTimeZoneFromValues,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import { clampInt } from '@/lib/pick'
import { bufferOrZero } from '@/lib/booking/conflicts'
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
  // ClientProfile id, present only when this pro is allowed to open the client's
  // chart (see getVisibleClientIdSetForPro). null keeps the id from leaking so the
  // name renders as plain text for anyone without access.
  clientProfileId: string | null
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

// Synthetic BOOKING-kind event used only for the management.waitlistToday list. Waitlist
// entries are not real calendar occupancy, so this carries no location and a 'WAITLIST'
// status (part of the client BookingCalendarStatus union). It never enters the top-level
// `events` grid — only the management modal / stats tile.
type WaitlistEvent = {
  id: string
  kind: 'BOOKING'
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  clientProfileId: string | null
  status: 'WAITLIST'
  locationType: null
  locationId: null
  durationMinutes: number
  timeZone: string
  timeZoneSource: TimeZoneTruthSource
  localDateKey: string
  viewLocalDateKey: string
  // Human label for the client's preferred time (e.g. "Any time", "Morning",
  // "Jun 14") shown in place of a concrete time on waitlist rows.
  preferenceLabel: string
  // Deep-link into the pre-filled new-booking flow (client + offering) so the
  // pro can offer a matching slot. null when the pro has no active offering for
  // the requested service.
  offerHref: string | null
  // The underlying waitlist entry + service/offering, so the pro can open the
  // availability-aware "Offer a time" modal and POST a proposed slot. (id here is
  // the raw WaitlistEntry.id — the row's `id` field carries the "waitlist:" prefix.)
  waitlistEntryId: string
  serviceId: string
  offeringId: string | null
  // A still-PENDING offer already sent for this entry, so the row can show
  // "Offer pending · <time>" instead of the offer action. null when none outstanding.
  pendingOffer: {
    id: string
    startsAt: string
    locationType: ServiceLocationType
  } | null
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
      id: true,
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
      itemType: true,
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

/**
 * Fixed-length step over INSTANTS — deliberately not local-day arithmetic.
 *
 * Only the range guard uses this, where `from` is an arbitrary caller-supplied
 * instant and the ceiling means "at most this much time", not "this many days
 * on the pro's calendar". Anything anchored to a local midnight must use
 * `startOfDayUtcInTimeZone(…, dayOffset)` instead, or it drifts by an hour
 * across a DST transition.
 */
function addRangeSpanUtc(date: Date, days: number): Date {
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
  const defaultToExclusive = addRangeSpanUtc(from, DEFAULT_CALENDAR_RANGE_DAYS)

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

  const maxToExclusive = addRangeSpanUtc(from, MAX_CALENDAR_RANGE_DAYS)

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
  return formatBookingServicesLabel(
    booking.serviceItems.map((item) => ({
      name: item.service?.name,
      itemType: item.itemType,
    })),
    booking.service?.name?.trim() || DEFAULT_BOOKING_SERVICE_NAME,
  )
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

/**
 * The ClientProfile id to expose on an event, gated by the pro's visible-client
 * set so it never leaks for a client the pro is not allowed to open.
 */
function linkableClientProfileId(
  clientId: string | null | undefined,
  visibleClientIds: ReadonlySet<string>,
): string | null {
  return clientId && visibleClientIds.has(clientId) ? clientId : null
}

function toBookingEvent(args: {
  booking: BookingRow
  professionalTimeZone: string | null
  viewportTimeZone: string
  visibleClientIds: ReadonlySet<string>
}): BookingEvent | null {
  const { booking, professionalTimeZone, viewportTimeZone, visibleClientIds } =
    args

  if (!booking.locationId) return null

  const start = new Date(booking.scheduledFor)

  if (!Number.isFinite(start.getTime())) return null

  const durationMinutes = safeDurationMinutes(booking.totalDurationMinutes)
  const bufferMinutes = bufferOrZero(booking.bufferMinutes)
  const end = addMinutes(start, durationMinutes + bufferMinutes)

  // Timezone precedence (booking snapshot → location → professional → UTC) is
  // resolved purely from values already loaded with the booking. Every booking
  // in this range shares the selected location, so the per-row location lookup
  // that resolveAppointmentSchedulingContext performs is redundant here — it can
  // only ever return booking.location.timeZone, which is already in hand. Using
  // the pure resolver keeps the result identical while dropping an N+1 query.
  const tzResult = resolveApptTimeZoneFromValues({
    bookingLocationTimeZone: booking.locationTimeZone,
    locationTimeZone: booking.location?.timeZone,
    professionalTimeZone,
    fallback: 'UTC',
    requireValid: false,
  })

  const appointmentTimeZone = tzResult.ok
    ? safeEventTimeZone(tzResult.timeZone)
    : 'UTC'

  const timeZoneSource: TimeZoneTruthSource = tzResult.ok
    ? tzResult.source
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
    clientProfileId: linkableClientProfileId(booking.client?.id, visibleClientIds),
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

const waitlistSelect = {
  id: true,
  status: true,
  createdAt: true,
  serviceId: true,
  preferenceType: true,
  specificDate: true,
  timeOfDay: true,
  windowStartMin: true,
  windowEndMin: true,
  service: { select: { name: true } },
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      user: { select: { email: true } },
    },
  },
} satisfies Prisma.WaitlistEntrySelect

type WaitlistRow = Prisma.WaitlistEntryGetPayload<{ select: typeof waitlistSelect }>

function getWaitlistClientName(entry: WaitlistRow): string {
  const firstName = entry.client?.firstName?.trim() ?? ''
  const lastName = entry.client?.lastName?.trim() ?? ''
  const email = entry.client?.user?.email?.trim() ?? ''

  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim()
  }

  return email || DEFAULT_BOOKING_CLIENT_NAME
}

/**
 * Deep-link into the pre-filled new-booking flow so the pro can offer a
 * waitlist client a matching slot. Returns null when there's no active offering
 * for the requested service (nothing bookable to pre-fill).
 *
 * ⚠️ `clientProfileId` here is the RAW id, deliberately — not the gated one the
 * event's own `clientProfileId` field carries. The two answer different
 * questions and are allowed to disagree: the field decides whether to render a
 * chart LINK (booking-based, `getVisibleClientIdSetForPro`), while this href is
 * just a destination, and that destination runs the real, broader gate itself —
 * `BookingCreateContent` calls `getProClientVisibility` and pre-fills nothing
 * unless it passes. Narrowing this to the gated id would delete the offer link
 * for exactly the clients it exists for: waitlist clients the pro has messaged
 * but never booked, who are viewable via `ACTIVE_THREAD` yet absent from the
 * booking-based set.
 */
function buildWaitlistOfferHref(args: {
  clientProfileId: string | null | undefined
  offeringId: string | null | undefined
}): string | null {
  const { clientProfileId, offeringId } = args
  if (!clientProfileId || !offeringId) return null

  const params = new URLSearchParams({
    clientId: clientProfileId,
    offeringId,
  })

  return `/pro/bookings/new?${params.toString()}`
}

type PendingOfferSummary = {
  id: string
  startsAt: string
  locationType: ServiceLocationType
}

function toWaitlistEvent(args: {
  entry: WaitlistRow
  viewportTimeZone: string
  viewportTodayKey: string
  offeringIdByServiceId: ReadonlyMap<string, string>
  pendingOfferByEntryId: ReadonlyMap<string, PendingOfferSummary>
  visibleClientIds: ReadonlySet<string>
}): WaitlistEvent | null {
  const {
    entry,
    viewportTimeZone,
    viewportTodayKey,
    offeringIdByServiceId,
    pendingOfferByEntryId,
    visibleClientIds,
  } = args

  const serviceName = entry.service?.name?.trim() || DEFAULT_BOOKING_SERVICE_NAME

  // Waitlist rows carry no concrete occupancy: anchor the synthetic instant to
  // the join time so the list sorts FIFO (oldest first), matching /pro/waitlist.
  const joinedAt = entry.createdAt.toISOString()

  const preferenceLabel = formatWaitlistPreferenceLabel({
    preferenceType: entry.preferenceType,
    specificDate: entry.specificDate,
    timeOfDay: entry.timeOfDay,
    windowStartMin: entry.windowStartMin,
    windowEndMin: entry.windowEndMin,
  })

  return {
    id: `waitlist:${entry.id}`,
    kind: 'BOOKING',
    startsAt: joinedAt,
    endsAt: joinedAt,
    title: serviceName,
    clientName: getWaitlistClientName(entry),
    clientProfileId: linkableClientProfileId(entry.client?.id, visibleClientIds),
    status: 'WAITLIST',
    locationType: null,
    locationId: null,
    durationMinutes: 0,
    timeZone: safeEventTimeZone(viewportTimeZone),
    timeZoneSource: 'PROFESSIONAL',
    localDateKey: utcDateToLocalYmd(entry.createdAt, viewportTimeZone),
    viewLocalDateKey: viewportTodayKey,
    preferenceLabel,
    offerHref: buildWaitlistOfferHref({
      clientProfileId: entry.client?.id,
      offeringId: offeringIdByServiceId.get(entry.serviceId) ?? null,
    }),
    waitlistEntryId: entry.id,
    serviceId: entry.serviceId,
    offeringId: offeringIdByServiceId.get(entry.serviceId) ?? null,
    pendingOffer: pendingOfferByEntryId.get(entry.id) ?? null,
    details: {
      serviceName,
      bufferMinutes: 0,
      serviceItems: [],
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
    event.status === BookingStatus.IN_PROGRESS ||
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

    // Which of this pro's clients they're allowed to open (chart access). Used to
    // gate the clientProfileId we expose on booking / waitlist events so names can
    // link to the pro-only client chart without leaking ids for anyone else.
    const visibleClientIds = await getVisibleClientIdSetForPro(professionalId)

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

    const bookingEvents = bookings
      .map((booking) =>
        toBookingEvent({
          booking,
          professionalTimeZone: proProfile.timeZone,
          viewportTimeZone,
          visibleClientIds,
        }),
      )
      .filter((event): event is BookingEvent => event !== null)

    const blockEvents = blocks
      .map((block) => toBlockEvent(block, viewportTimeZone))
      .filter((event): event is BlockEvent => event !== null)

    const events = sortCalendarEvents([...bookingEvents, ...blockEvents])

    const viewportTodayKey = utcDateToLocalYmd(now, viewportTimeZone)
    const viewportTodayStart = startOfDayUtcInTimeZone(now, viewportTimeZone)
    // Whole LOCAL days, not +24h: on the two DST days a year the pro's local day
    // is 23 or 25 hours long, and a fixed 86_400_000ms step put this boundary an
    // hour inside the next day (spring) or an hour short of midnight (autumn) —
    // so "blocked minutes today" counted tomorrow's blocks, or dropped the last
    // hour of today's.
    const viewportTomorrowStart = startOfDayUtcInTimeZone(
      now,
      viewportTimeZone,
      1,
    )

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

    // The pro's full active waitlist (FIFO by join time), so the calendar's
    // Waitlist tab shows every client waiting — with their requested service and
    // preferred-time label — not just same-day holds.
    //
    // NOTIFIED entries are included because sending an offer moves the entry
    // there: filtering them out made the "Offered · <time>" badge below
    // unreachable and left the pro with no surface anywhere showing an offer
    // they had sent. Since F14 that offer also RESERVES the slot, so this row is
    // the pro's only explanation for the time missing from their availability.
    const waitlistRows = await prisma.waitlistEntry.findMany({
      where: {
        professionalId,
        status: { in: [WaitlistStatus.ACTIVE, WaitlistStatus.NOTIFIED] },
      },
      select: waitlistSelect,
      orderBy: { createdAt: 'asc' },
      take: MAX_CALENDAR_EVENTS_PER_RANGE,
    })

    // Resolve each waitlisted service to the pro's active offering (unique per
    // professional+service) so the "Offer a time" action can deep-link the
    // pre-filled new-booking flow. Batched to avoid an N+1.
    const waitlistServiceIds = [
      ...new Set(waitlistRows.map((entry) => entry.serviceId)),
    ]
    const offeringRows =
      waitlistServiceIds.length > 0
        ? await prisma.professionalServiceOffering.findMany({
            where: {
              professionalId,
              serviceId: { in: waitlistServiceIds },
              isActive: true,
            },
            select: { id: true, serviceId: true },
          })
        : []
    const offeringIdByServiceId = new Map(
      offeringRows.map((offering) => [offering.serviceId, offering.id]),
    )

    // Any still-live offers already sent for the listed entries, so the Waitlist
    // tab shows "Offered · <time>" instead of re-offering. The expiry filter
    // matches assertConfirmableWaitlistOffer: an expired offer is one the client
    // can no longer confirm, so it must stop suppressing the offer action or the
    // pro is stuck looking at a promise nobody can accept.
    const waitlistEntryIds = waitlistRows.map((entry) => entry.id)
    const pendingOfferRows =
      waitlistEntryIds.length > 0
        ? await prisma.waitlistOffer.findMany({
            where: {
              waitlistEntryId: { in: waitlistEntryIds },
              status: WaitlistOfferStatus.PENDING,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            select: {
              id: true,
              waitlistEntryId: true,
              startsAt: true,
              locationType: true,
            },
          })
        : []
    const pendingOfferByEntryId = new Map<string, PendingOfferSummary>(
      pendingOfferRows.map((offer) => [
        offer.waitlistEntryId,
        {
          id: offer.id,
          startsAt: offer.startsAt.toISOString(),
          locationType: offer.locationType,
        },
      ]),
    )

    const waitlistTodayEvents = waitlistRows
      .map((entry) =>
        toWaitlistEvent({
          entry,
          viewportTimeZone,
          viewportTodayKey,
          offeringIdByServiceId,
          pendingOfferByEntryId,
          visibleClientIds,
        }),
      )
      .filter((event): event is WaitlistEvent => event !== null)

    const stats: CalendarStats = {
      todaysBookings: todaysBookingsEvents.length,
      availableHours: null,
      pendingRequests: pendingRequestEvents.length,
      blockedHours: roundedCalendarHours(blockedMinutesToday),
    }

    return jsonOk(
      {
        // The authed pro's own id — used by the waitlist "Offer a time" modal to
        // query availability (GET /api/v1/availability/day) for a proposed slot.
        professionalId,
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
          waitlistToday: waitlistTodayEvents,
          blockedToday: blockedTodayEvents,
        },
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/v1/pro/calendar error:', error)

    return jsonFail(500, 'Failed to load pro calendar.', {
      code: 'INTERNAL_ERROR',
    })
  }
}