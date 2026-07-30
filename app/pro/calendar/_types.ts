// app/pro/calendar/_types.ts

import type { IanaTimeZone } from '@/lib/timeZone'
import type { PaymentBadge } from '@/lib/booking/paymentBadge'
import type { RelationshipBadge } from '@/lib/booking/relationshipLabel'
import type { CalendarScopeMode } from '@/lib/calendar/constants'
import type { CalendarSwatchId } from '@/lib/calendar/eventColor'

export type ViewMode = 'day' | 'week' | 'month'
export type EntityType = 'booking' | 'block'

export type CalendarDisplayDensity = 'full' | 'compact' | 'micro'

export type WeekdayKey =
  | 'sun'
  | 'mon'
  | 'tue'
  | 'wed'
  | 'thu'
  | 'fri'
  | 'sat'

export type TimeZoneTruthSource =
  | 'BOOKING_SNAPSHOT'
  | 'HOLD_SNAPSHOT'
  | 'LOCATION'
  | 'PROFESSIONAL'
  | 'FALLBACK'

/**
 * UI-facing location mode.
 * Keep this narrow because calendar layout logic only understands these modes.
 */
export type CalendarLocationType = 'SALON' | 'MOBILE'

/**
 * Backend-facing service location mode.
 * Keep this extensible because backend/provider enums may grow.
 */
export type ServiceLocationType =
  | CalendarLocationType
  | (string & Record<never, never>)

/**
 * Backend-facing booking status.
 * Known values get strong handling, but future statuses should not break parsing.
 */
export type BookingCalendarStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'CONFIRMED'
  // A session the pro has already started. The feed filters only CANCELLED, so
  // this has always reached the grid — it just had no name in this union, and
  // no arm in either event-label resolver, so it rendered as "Accepted" (B10).
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DECLINED'
  | 'NO_SHOW'
  | 'RESCHEDULE_REQUESTED'
  | 'WAITLIST'
  | 'UNKNOWN'
  | (string & Record<never, never>)

export type BlockCalendarStatus = 'BLOCKED'
export type HoldCalendarStatus = 'HELD'
export type CalendarStatus =
  | BookingCalendarStatus
  | BlockCalendarStatus
  | HoldCalendarStatus

export type WorkingHoursDay = {
  enabled: boolean
  start: string
  end: string
}

export type WorkingHoursJson = Record<WeekdayKey, WorkingHoursDay> | null

export type CalendarStats = {
  todaysBookings: number
  availableHours: number | null
  pendingRequests: number
  blockedHours: number | null
} | null

export type ServiceOption = {
  id: string
  name: string
  durationMinutes?: number | null
  offeringId?: string
  priceStartingAt?: string | null
}

export type BookingServiceItemType =
  | 'BASE'
  | 'ADD_ON'
  | (string & Record<never, never>)

export type BookingServiceItem = {
  id: string
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  serviceName: string
  priceSnapshot: string | null
  durationMinutesSnapshot: number
  sortOrder: number
}

export type BookingClientSnapshot = {
  fullName: string
  email: string | null
  phone: string | null
}

export type BookingDetails = {
  id: string
  status: BookingCalendarStatus
  scheduledFor: string
  endsAt: string

  locationId?: string | null
  locationType?: ServiceLocationType | null

  locationAddressSnapshot?: string | null
  locationLatSnapshot?: number | null
  locationLngSnapshot?: number | null

  totalDurationMinutes: number
  durationMinutes?: number | null
  bufferMinutes?: number | null
  subtotalSnapshot?: string | null

  client: BookingClientSnapshot

  timeZone: IanaTimeZone
  timeZoneSource?: TimeZoneTruthSource
  serviceItems: BookingServiceItem[]
}

export type CalendarServiceItem = {
  id: string
  name: string | null
  durationMinutes: number
  price: string | null
  sortOrder: number
}

export type BookingEventDetails = {
  serviceName: string
  bufferMinutes: number
  serviceItems: CalendarServiceItem[]
}

type CalendarEventBase = {
  id: string
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  durationMinutes?: number
  locationId: string | null
}

export type BookingCalendarEvent = CalendarEventBase & {
  kind: 'BOOKING'
  status: BookingCalendarStatus
  locationType: ServiceLocationType | null

  /**
   * At-a-glance payment state (deposit / paid / disputed …) derived server-side
   * by lib/booking/paymentBadge.ts. Absent on waitlist rows and when the wire
   * value fails to parse — the card simply omits the chip then (K1).
   */
  paymentBadge?: PaymentBadge

  /**
   * NR/NNR/RR/RNR client-relationship mark (K5), mapped server-side from the
   * per-booking SNAPSHOT column by lib/booking/relationshipLabel.ts. Absent on
   * waitlist rows and when the wire value fails to parse — the card simply
   * omits the chip then (and UNKNOWN is insignificant, so it never renders).
   */
  relationshipBadge?: RelationshipBadge

  /**
   * The pro's colour for this booking's service (K7), resolved server-side by
   * lib/calendar/eventColor.ts and painted on the card's 4px accent stripe —
   * the SERVICE channel. Absent means neutral: the stripe keeps its status
   * tone, which is every booking today, because the swatch a pro picks is
   * stored by K8.
   */
  serviceSwatch?: CalendarSwatchId

  /**
   * ClientProfile id, present only when the viewing pro may open this client's
   * chart. `null`/absent → the name renders as plain text (no link, no id leak).
   */
  clientProfileId?: string | null

  /**
   * Waitlist rows only: human label for the client's preferred time
   * (e.g. "Any time", "Morning", "Jun 14"), shown in place of a concrete time.
   */
  preferenceLabel?: string

  /**
   * Waitlist rows only: deep-link into the pre-filled new-booking flow so the
   * pro can offer a matching slot. Absent when there's no active offering.
   */
  offerHref?: string | null

  /**
   * Waitlist rows only: the underlying entry + service/offering, so the pro can
   * open the availability-aware "Offer a time" modal and POST a proposed slot.
   */
  waitlistEntryId?: string
  serviceId?: string
  offeringId?: string | null

  /**
   * Waitlist rows only: a still-PENDING offer already sent for this entry, so
   * the row shows "Offer pending · <time>" in place of the offer action.
   */
  pendingOffer?: {
    id: string
    startsAt: string
    locationType: ServiceLocationType
  } | null

  /**
   * Authoritative appointment-local timezone for this booking.
   */
  timeZone: IanaTimeZone

  timeZoneSource: TimeZoneTruthSource

  /**
   * Day key in the booking appointment timezone.
   */
  localDateKey: string

  /**
   * Day key in the selected calendar viewport timezone.
   */
  viewLocalDateKey?: string

  details: BookingEventDetails

  note?: never
  blockId?: never
}

export type BlockCalendarEvent = CalendarEventBase & {
  kind: 'BLOCK'
  blockId: string
  status: BlockCalendarStatus
  note: string | null

  /**
   * Block rows are viewport-scoped in the current calendar payload.
   */
  localDateKey?: string

  details?: never
  locationType?: never
  timeZone?: never
  timeZoneSource?: never
  viewLocalDateKey?: never
}

/**
 * A client's live checkout reservation (B5). Read-only occupancy: it cannot be
 * opened, dragged, resized or edited — it expires on its own within
 * `HOLD_MINUTES`. Deliberately anonymous, so it carries no `clientProfileId`
 * and its `clientName` is a fixed label rather than a person.
 */
export type HoldCalendarEvent = CalendarEventBase & {
  kind: 'HOLD'
  holdId: string
  status: HoldCalendarStatus
  locationType: ServiceLocationType | null
  localDateKey?: string

  /** When the reservation lapses on its own. */
  expiresAt: string

  details?: never
  note?: never
  blockId?: never
  timeZone?: never
  timeZoneSource?: never
  viewLocalDateKey?: never
}

export type CalendarEvent =
  | BookingCalendarEvent
  | BlockCalendarEvent
  | HoldCalendarEvent

export type PendingResizeChange = {
  kind: 'resize'
  entityType: EntityType
  eventId: string
  apiId: string
  nextTotalDurationMinutes: number
  original: CalendarEvent
}

export type PendingMoveChange = {
  kind: 'move'
  entityType: EntityType
  eventId: string
  apiId: string
  nextStartIso: string
  original: CalendarEvent
}

export type PendingChange = PendingResizeChange | PendingMoveChange

export type ManagementKey =
  | 'todaysBookings'
  | 'pendingRequests'
  | 'waitlistToday'
  | 'blockedToday'

export type ManagementLists = Record<ManagementKey, CalendarEvent[]>

export type BlockRow = {
  id: string
  startsAt: string | Date
  endsAt: string | Date
  note?: string | null
  locationId?: string | null
}

export type CalendarResponseLocation = {
  id: string
  type: string
  timeZone: string | null
  timeZoneValid: boolean
}

export type CalendarRangeMeta = {
  from: string
  requestedTo: string
  effectiveTo: string
  clamped: boolean
  maxDays: number
}

export type CalendarResponse = {
  /** The authed pro's own id — used by the waitlist "Offer a time" modal. */
  professionalId?: string
  /**
   * Which locations the events came from (K3). `ALL` = every location, the
   * scope the DB's overlap constraint actually enforces; `LOCATION` = filtered
   * to `location`. In ALL scope `location` is only the VIEWPORT ANCHOR (whose
   * timezone the grid is drawn in) and must not be adopted as the selection.
   */
  scope: CalendarScopeMode
  location: CalendarResponseLocation | null
  range: CalendarRangeMeta

  timeZone: string
  viewportTimeZone: string
  needsTimeZoneSetup: boolean

  events: CalendarEvent[]

  canSalon: boolean
  canMobile: boolean

  stats: CalendarStats
  blockedMinutesToday: number

  autoAcceptBookings: boolean
  management: ManagementLists
}