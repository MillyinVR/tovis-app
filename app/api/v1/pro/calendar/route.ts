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
import { holdRecordToBusyInterval } from '@/lib/booking/conflictQueries'
import { formatBookingServicesLabel } from '@/lib/booking/serviceLabel'
import {
  PAYMENT_BADGE_SELECT,
  derivePaymentBadge,
} from '@/lib/booking/paymentBadge'
import {
  RELATIONSHIP_BADGE_SELECT,
  deriveRelationshipBadge,
} from '@/lib/booking/relationshipLabel'
import { utcDateToLocalYmd } from '@/lib/booking/dateTime'
import {
  resolveApptTimeZoneFromValues,
  type TimeZoneTruthSource,
} from '@/lib/booking/timeZoneTruth'
import type {
  ProCalendarBlockEventDTO,
  ProCalendarBookingEventDTO,
  ProCalendarEventDTO,
  ProCalendarHoldEventDTO,
  ProCalendarResponseDTO,
  ProCalendarServiceItemDTO,
  ProCalendarStatsDTO,
  ProCalendarWaitlistEventDTO,
} from '@/lib/dto/proCalendar'
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
  loadOfferingSwatchesByServiceId,
  resolveBookingServiceSwatch,
} from '@/lib/calendar/serviceSwatch'

import {
  CALENDAR_MS_PER_DAY,
  CALENDAR_SCOPE_ALL,
  DEFAULT_BLOCK_CLIENT_NAME,
  DEFAULT_BLOCK_TITLE,
  DEFAULT_BOOKING_CLIENT_NAME,
  DEFAULT_BOOKING_SERVICE_NAME,
  DEFAULT_CALENDAR_RANGE_DAYS,
  DEFAULT_HOLD_CLIENT_NAME,
  DEFAULT_HOLD_TITLE,
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

// The wire shapes live in lib/dto/proCalendar.ts — named types, exported
// through the DTO barrel, so the device's captured payload is checked against
// the real contract by scripts/contract/validate-fixtures.mjs. The local
// aliases below keep this file's ~1,400 lines reading as they did.
type CalendarServiceItem = ProCalendarServiceItemDTO
type BookingEvent = ProCalendarBookingEventDTO
type WaitlistEvent = ProCalendarWaitlistEventDTO
type BlockEvent = ProCalendarBlockEventDTO
type HoldEvent = ProCalendarHoldEventDTO
type CalendarEvent = ProCalendarEventDTO
type CalendarStats = ProCalendarStatsDTO

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

/**
 * Which locations this request's occupancy is drawn from.
 *
 * 🔴 The audit behind K3: `Booking_no_active_professional_overlap` excludes on
 * `professionalId` ALONE — there is no location term in the constraint — so the
 * database treats the pro as ONE resource. A feed filtered to one location
 * therefore renders free space that a job at another location already owns.
 * `ALL` is the scope that matches what the database enforces.
 *
 * `anchor` is the location the VIEWPORT is resolved from (timezone, the
 * `location` echo, `needsTimeZoneSetup`). In `LOCATION` scope it is also the
 * filter; in `ALL` scope it is only an anchor and filters nothing.
 */
type CalendarScope =
  | {
      mode: 'ALL'
      anchor: ProfessionalLocationRow
    }
  | {
      mode: 'LOCATION'
      anchor: ProfessionalLocationRow
      location: ProfessionalLocationRow
    }

type CalendarScopeResult =
  | {
      ok: true
      scope: CalendarScope
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
  // K8 service-colour fallback key: the pro's offering for THIS service, for
  // the bookings whose own `offeringId` is null.
  serviceId: true,
  // Payment-badge inputs (deposit + checkout + dispute columns) — spread from
  // the helper's select so the badge can never miss a field it derives from.
  ...PAYMENT_BADGE_SELECT,
  // Relationship-badge input: only the K5 snapshot column, by design.
  ...RELATIONSHIP_BADGE_SELECT,
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
  // K8 service-colour input: the booking's OWN offering link. Nullable, which
  // is why the route also loads the per-serviceId fallback map.
  offering: {
    select: {
      calendarSwatch: true,
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
      // K8: the BASE item's offering wins the colour (an add-on gloss must not
      // repaint a colour appointment) — see resolveCalendarSwatch.
      offering: {
        select: {
          calendarSwatch: true,
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

// Exactly the columns `holdRecordToBusyInterval` reads, plus what the segment
// needs to render. Selecting the SAME columns the conflict gate reads is the
// point of this card: the segment the pro sees is the window the write path
// actually reserves, not a second opinion about it.
// ⚠️ NO client columns — the segment is anonymous by design (see HoldEvent).
const calendarHoldSelect = {
  id: true,
  scheduledFor: true,
  expiresAt: true,
  locationId: true,
  locationType: true,
  endsAtSnapshot: true,
  durationMinutesSnapshot: true,
  bufferMinutesSnapshot: true,
  offering: {
    select: {
      salonDurationMinutes: true,
      mobileDurationMinutes: true,
    },
  },
  location: {
    select: {
      bufferMinutes: true,
    },
  },
} satisfies Prisma.BookingHoldSelect

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

type CalendarHoldRow = Prisma.BookingHoldGetPayload<{
  select: typeof calendarHoldSelect
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
  anchorLocation: ProfessionalLocationRow
  profile: ProfessionalProfileRow
}): ViewportTimeZoneResult {
  const selectedLocationTimeZoneRaw =
    typeof args.anchorLocation.timeZone === 'string' &&
    args.anchorLocation.timeZone.trim()
      ? args.anchorLocation.timeZone.trim()
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

/**
 * Resolves `?scope=` + `?locationId=` into the scope this request answers for.
 *
 * The wire contract is deliberately OPT-IN: `scope` absent reproduces the
 * pre-K3 behaviour exactly (`locationId`, else the primary bookable location).
 * The native client sends `locationId` — or nothing at all, since it leaves its
 * `activeLocationId` nil until the pro picks one — so widening the *default*
 * would have changed what an unchanged device shows, in a build with no
 * per-location marker to explain it. iOS gets ALL in K4, on purpose. The WEB
 * calendar defaults to `scope=ALL`; that is where "default ALL" lives.
 *
 * `scope` accepts `ALL` or a location id (`scope=<id>` ≡ `locationId=<id>`) and
 * wins over `locationId` when both are sent.
 */
function getCalendarScope(args: {
  locations: ProfessionalLocationRow[]
  requestedScope: string
  requestedLocationId: string
}): CalendarScopeResult {
  const { locations, requestedScope, requestedLocationId } = args

  const anchor = locations.find((location) => location.isPrimary) ?? locations[0]

  if (!anchor) {
    return {
      ok: false,
      status: 409,
      code: 'LOCATION_REQUIRED',
      message: 'Add a bookable location to use the calendar.',
    }
  }

  if (requestedScope.toUpperCase() === CALENDAR_SCOPE_ALL) {
    return {
      ok: true,
      scope: {
        mode: 'ALL',
        anchor,
      },
    }
  }

  const requestedId = requestedScope || requestedLocationId

  if (requestedId) {
    const requested = locations.find((location) => location.id === requestedId)

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
      scope: {
        mode: 'LOCATION',
        anchor: requested,
        location: requested,
      },
    }
  }

  return {
    ok: true,
    scope: {
      mode: 'LOCATION',
      anchor,
      location: anchor,
    },
  }
}

/**
 * The one place the scope decides whether a query gets a location term at all:
 * the id to filter on, or `null` for "no location term", which is precisely
 * what `Booking_no_active_professional_overlap` does.
 */
function scopeLocationId(scope: CalendarScope): string | null {
  return scope.mode === 'ALL' ? null : scope.location.id
}

/**
 * Location term for the two queries whose rows always carry a location —
 * bookings and B5's live checkout holds. Leaving either one filtered in ALL
 * scope reintroduces exactly the invisible-occupancy bug this step exists to
 * fix, so they share a builder rather than each carrying their own `if`.
 */
function occupancyLocationWhere(scope: CalendarScope): { locationId?: string } {
  const locationId = scopeLocationId(scope)

  return locationId ? { locationId } : {}
}

/**
 * Blocks alone may have a NULL location — that is the pro's time everywhere, so
 * it belongs to every location's view and to ALL scope.
 */
function blockLocationWhere(
  scope: CalendarScope,
): Pick<Prisma.CalendarBlockWhereInput, 'OR'> {
  const locationId = scopeLocationId(scope)

  return locationId ? { OR: [{ locationId }, { locationId: null }] } : {}
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
  swatchByServiceId: ReadonlyMap<string, string>
}): BookingEvent | null {
  const {
    booking,
    professionalTimeZone,
    viewportTimeZone,
    visibleClientIds,
    swatchByServiceId,
  } = args

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
  const serviceSwatch = resolveBookingServiceSwatch(booking, swatchByServiceId)

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
    paymentBadge: derivePaymentBadge(booking),
    relationshipBadge: deriveRelationshipBadge(booking),
    // Optional on the wire (K7) — omitted entirely when the pro has chosen no
    // colour for the service, so an event with no swatch is byte-identical to
    // what it was before K8 and the card renders no `data-swatch` attribute.
    ...(serviceSwatch ? { serviceSwatch } : {}),
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

/**
 * A live hold → the anonymous occupancy segment the pro sees.
 *
 * The window comes from `holdRecordToBusyInterval` — the SAME builder the
 * availability reads and the write-boundary overlap gate use — so the segment
 * cannot disagree with what the slot actually reserves. Re-deriving it here
 * from `scheduledFor + durationMinutesSnapshot` would be a fourth opinion on a
 * question that already has one answer ([[drifted-duplicate-is-a-bug-report]]).
 */
function toHoldEvent(
  hold: CalendarHoldRow,
  viewportTimeZone: string,
): HoldEvent | null {
  const interval = holdRecordToBusyInterval({
    hold,
    defaultBufferMinutes: bufferOrZero(hold.location?.bufferMinutes),
    fallbackDurationMinutes: DEFAULT_DURATION_MINUTES,
  })

  const start = interval.start
  const end = interval.end

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null
  }

  if (end.getTime() <= start.getTime()) return null

  return {
    id: `hold:${hold.id}`,
    holdId: hold.id,
    kind: 'HOLD',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    title: DEFAULT_HOLD_TITLE,
    clientName: DEFAULT_HOLD_CLIENT_NAME,
    status: 'HELD',
    locationType: hold.locationType,
    locationId: hold.locationId ?? null,
    durationMinutes: Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60_000),
    ),
    localDateKey: utcDateToLocalYmd(start, viewportTimeZone),
    expiresAt: hold.expiresAt.toISOString(),
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
    const requestedScope = (url.searchParams.get('scope') || '').trim()

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

    const scopeResult = getCalendarScope({
      locations,
      requestedScope,
      requestedLocationId,
    })

    if (!scopeResult.ok) {
      return jsonFail(scopeResult.status, scopeResult.message, {
        code: scopeResult.code,
      })
    }

    const scope = scopeResult.scope
    const anchorLocation = scope.anchor
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
      anchorLocation,
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

    const [bookings, blocks, holds, swatchByServiceId] = await Promise.all([
      prisma.booking.findMany({
        where: {
          professionalId,
          // ALL scope drops the location term entirely rather than listing the
          // pro's bookable location ids: the overlap constraint has no location
          // term either, and an `in` list would silently hide a booking at a
          // location since made unbookable (or past MAX_CALENDAR_LOCATIONS_PER_PRO)
          // — occupancy the pro genuinely does not have free.
          ...occupancyLocationWhere(scope),
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
          ...blockLocationWhere(scope),
        },
        select: calendarBlockSelect,
        orderBy: {
          startsAt: 'asc',
        },
        take: MAX_CALENDAR_EVENTS_PER_RANGE
      }),
      // Live holds only. An EXPIRED hold reserves nothing — the conflict gate
      // already ignores it (`expiresAt: { gt: now }`) and the */5 cleanup cron
      // sweeps it — so rendering one would put a segment on the calendar over
      // time that is genuinely free.
      //
      // Location-scoped to match the BOOKING query above rather than the BLOCK
      // query's `OR [selected, null]`: a hold always carries the location it
      // was taken at. In ALL scope it widens with them — a hold left filtered
      // here would undo B5's truth-fix in exactly the mode that exists to tell
      // the truth, and a cross-location hold is occupancy the write path
      // already refuses to book over.
      //
      // The window filter is `scheduledFor`-based like the booking query. A
      // hold's rendered end can extend past `scheduledFor` by its snapshot
      // duration + buffer, which is the same tail the booking query has and is
      // bounded by the same MAX_SLOT_DURATION_MINUTES.
      prisma.bookingHold.findMany({
        where: {
          professionalId,
          ...occupancyLocationWhere(scope),
          expiresAt: { gt: now },
          scheduledFor: {
            gte: from,
            lt: effectiveToExclusive,
          },
        },
        select: calendarHoldSelect,
        orderBy: {
          scheduledFor: 'asc',
        },
        take: MAX_CALENDAR_EVENTS_PER_RANGE
      }),
      // K8 service colour: the pro's chosen colours, for the bookings whose own
      // `offeringId` is null. Keyed on the pro alone, so it belongs IN this
      // Promise.all rather than after it — this route's known performance
      // problem is a fetch waterfall, and a lookup narrowed to the bookings'
      // service ids would have had to wait for them.
      loadOfferingSwatchesByServiceId({ db: prisma, professionalId }),
    ])

    const bookingEvents = bookings
      .map((booking) =>
        toBookingEvent({
          booking,
          professionalTimeZone: proProfile.timeZone,
          viewportTimeZone,
          visibleClientIds,
          swatchByServiceId,
        }),
      )
      .filter((event): event is BookingEvent => event !== null)

    const blockEvents = blocks
      .map((block) => toBlockEvent(block, viewportTimeZone))
      .filter((event): event is BlockEvent => event !== null)

    const holdEvents = holds
      .map((hold) => toHoldEvent(hold, viewportTimeZone))
      .filter((event): event is HoldEvent => event !== null)

    const events = sortCalendarEvents([
      ...bookingEvents,
      ...blockEvents,
      ...holdEvents,
    ])

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

    // `satisfies` is the guard: this payload IS the published contract
    // (lib/dto/proCalendar.ts), so adding a field here without adding it there
    // — the drift that left K1/K3/K5's fields uncovered — fails the build.
    const payload = {
      // The authed pro's own id — used by the waitlist "Offer a time" modal to
      // query availability (GET /api/v1/availability/day) for a proposed slot.
      professionalId,
      // Which locations the events below came from. `LOCATION` means
      // `location` is also the filter; `ALL` means it is ONLY the viewport
      // anchor and the feed spans every location. A client that adopts
      // `location.id` as its selection must gate that on this field, or
      // asking for ALL bounces straight back to one location
      // ([[two-states-owning-one-selection]]).
      scope: scope.mode,
      location: {
        id: anchorLocation.id,
        type: anchorLocation.type,
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
    } satisfies ProCalendarResponseDTO

    return jsonOk(payload, 200)
  } catch (error) {
    console.error('GET /api/v1/pro/calendar error:', error)

    return jsonFail(500, 'Failed to load pro calendar.', {
      code: 'INTERNAL_ERROR',
    })
  }
}