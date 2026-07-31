// The pro calendar feed's wire contract — GET /api/v1/pro/calendar.
//
// These types used to live inline in the route, which meant the response had no
// NAME and therefore could not be exported through lib/dto/index.ts: the iOS
// contract validator (scripts/contract/validate-fixtures.mjs) had nothing to
// check the device's captured payload against. Every field the K-series has put
// on this feed — the K1 payment badge, K3's `scope`/`locationId`, K5's
// relationship mark — crossed to the device with zero contract coverage
// (K4-B / K5-B).
//
// Everything here is JSON-safe by construction (instants are ISO strings, money
// is a decimal string), and the route's response is `satisfies`-checked against
// `ProCalendarResponseDTO`, so a field added to one and not the other is a
// compile error rather than a silent wire change.

import type {
  BookingStatus,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'

import type { ClientConfirmationBadge } from '@/lib/booking/clientConfirmation'
import type { PaymentBadge } from '@/lib/booking/paymentBadge'
import type { RelationshipBadge } from '@/lib/booking/relationshipLabel'
import type { TimeZoneTruthSource } from '@/lib/booking/timeZoneTruth'
import type { CalendarSwatchId } from '@/lib/calendar/eventColor'

export type ProCalendarServiceItemDTO = {
  id: string
  name: string | null
  durationMinutes: number
  price: string | null
  sortOrder: number
}

export type ProCalendarEventDetailsDTO = {
  serviceName: string
  bufferMinutes: number
  serviceItems: ProCalendarServiceItemDTO[]
}

export type ProCalendarBookingEventDTO = {
  id: string
  kind: 'BOOKING'
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  /**
   * ClientProfile id, present only when this pro is allowed to open the client's
   * chart (see getVisibleClientIdSetForPro). null keeps the id from leaking so
   * the name renders as plain text for anyone without access.
   */
  clientProfileId: string | null
  status: BookingStatus
  locationType: ServiceLocationType | null
  locationId: string
  durationMinutes: number
  timeZone: string
  timeZoneSource: TimeZoneTruthSource
  localDateKey: string
  viewLocalDateKey: string
  /**
   * At-a-glance payment state (deposit / paid / disputed …), derived by THE one
   * helper (lib/booking/paymentBadge.ts) so this card, the bookings list and iOS
   * can never disagree about what the money is doing (K1).
   */
  paymentBadge: PaymentBadge
  /**
   * NR/NNR/RR/RNR client-relationship mark (K5) — mapped from the SNAPSHOT
   * column by the one helper (lib/booking/relationshipLabel.ts); never derived
   * from live history. iOS renders label/description verbatim (K6).
   */
  relationshipBadge: RelationshipBadge
  /**
   * The pro's colour for this booking's service (K7), resolved by the one
   * helper (lib/calendar/eventColor.ts) and painted on the card's 4px accent
   * stripe — the SERVICE channel, while status keeps the fill (decision D2).
   *
   * OPTIONAL, and absent on every booking today: the swatch a pro picks is
   * stored on `ProfessionalServiceOffering` by K8, so until then nothing has a
   * colour of its own and the stripe keeps its status tone. Absent must always
   * mean neutral, never a default hue — a colour nobody chose is a lie about
   * which service this is.
   */
  serviceSwatch?: CalendarSwatchId
  /**
   * Client-confirmation state (K11) — whether the CLIENT said they're coming,
   * derived by the one helper (lib/booking/clientConfirmation.ts) from the
   * loop's timestamp columns. Rendered as the card's CORNER GLYPH (K7's
   * channel budget), with `description` in the accessible name.
   *
   * OPTIONAL, and absent when confirmation was never requested — which, until
   * K12 ships the writers, is every booking, so today's payload is
   * byte-identical to pre-K11. Absent must always read as "not requested",
   * never as an error. 🔴 NOT derived from BookingStatus: PENDING tracks the
   * PRO's acceptance, the opposite direction.
   */
  clientConfirmation?: ClientConfirmationBadge
  details: ProCalendarEventDetailsDTO
}

/**
 * Synthetic BOOKING-kind event used only for the management.waitlistToday list.
 * Waitlist entries are not real calendar occupancy, so this carries no location
 * and a 'WAITLIST' status (part of the client BookingCalendarStatus union). It
 * never enters the top-level `events` grid — only the management modal / stats
 * tile.
 */
export type ProCalendarWaitlistEventDTO = {
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
  /**
   * Human label for the client's preferred time (e.g. "Any time", "Morning",
   * "Jun 14") shown in place of a concrete time on waitlist rows.
   */
  preferenceLabel: string
  /**
   * Deep-link into the pre-filled new-booking flow (client + offering) so the
   * pro can offer a matching slot. null when the pro has no active offering for
   * the requested service.
   */
  offerHref: string | null
  /**
   * The underlying waitlist entry + service/offering, so the pro can open the
   * availability-aware "Offer a time" modal and POST a proposed slot. (id here
   * is the raw WaitlistEntry.id — the row's `id` field carries the "waitlist:"
   * prefix.)
   */
  waitlistEntryId: string
  serviceId: string
  offeringId: string | null
  /**
   * A still-PENDING offer already sent for this entry, so the row can show
   * "Offer pending · <time>" instead of the offer action. null when none
   * outstanding.
   */
  pendingOffer: {
    id: string
    startsAt: string
    locationType: ServiceLocationType
  } | null
  details: ProCalendarEventDetailsDTO
}

export type ProCalendarBlockEventDTO = {
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

/**
 * A client's LIVE checkout reservation, shown so the pro's day tells the truth
 * about what their time is doing. Before B5 the feed rendered BOOKING + BLOCK
 * only, so a hold was invisible on the calendar AND in both overlap-warning
 * surfaces that read this array — while the write path happily authorized a pro
 * booking straight over it. [[reserving-a-slot-needs-a-surface]]
 *
 * Deliberately ANONYMOUS (Tori's call, 2026-07-25): no clientName, no
 * clientProfileId, no service name. A hold means somebody is mid-checkout this
 * minute; the pro needs to know the slot is spoken for, not who is hesitating
 * over it. It carries no `blockId`/`waitlistEntryId` because nothing acts on it
 * — it is a read-only occupancy segment that expires on its own.
 */
export type ProCalendarHoldEventDTO = {
  id: string
  holdId: string
  kind: 'HOLD'
  startsAt: string
  endsAt: string
  title: string
  clientName: string
  status: 'HELD'
  locationType: ServiceLocationType | null
  locationId: string | null
  durationMinutes: number
  localDateKey: string
  expiresAt: string
}

export type ProCalendarEventDTO =
  | ProCalendarBookingEventDTO
  | ProCalendarBlockEventDTO
  | ProCalendarHoldEventDTO

export type ProCalendarStatsDTO = {
  todaysBookings: number
  availableHours: number | null
  pendingRequests: number
  blockedHours: number
}

/**
 * Which locations the events came from (K3). `LOCATION` means `location` is
 * also the filter; `ALL` means it is ONLY the viewport anchor and the feed spans
 * every location.
 *
 * 🔴 A client that adopts `location.id` as its own selection must gate that on
 * this field, or asking for ALL bounces straight back to one location
 * ([[two-states-owning-one-selection]]). An ABSENT `scope` (a pre-K3 server)
 * must be read as LOCATION — that server always filtered, and reading its
 * answer as "everything" is the original bug inverted.
 */
export type ProCalendarScopeDTO = 'ALL' | 'LOCATION'

export type ProCalendarResponseDTO = {
  /**
   * The authed pro's own id — used by the waitlist "Offer a time" modal to query
   * availability (GET /api/v1/availability/day) for a proposed slot.
   */
  professionalId: string
  scope: ProCalendarScopeDTO
  location: {
    id: string
    /**
     * The PRO location's kind (SALON / SUITE / MOBILE_BASE …) — a
     * `ProfessionalLocationType`, NOT the `ServiceLocationType` an event's
     * `locationType` carries. The two enums are neighbours and don't overlap
     * fully; `SUITE` exists only here.
     */
    type: ProfessionalLocationType
    timeZone: string | null
    timeZoneValid: boolean
  }
  timeZone: string
  viewportTimeZone: string
  needsTimeZoneSetup: boolean
  range: {
    from: string
    requestedTo: string
    effectiveTo: string
    clamped: boolean
    maxDays: number
  }
  events: ProCalendarEventDTO[]
  canSalon: boolean
  canMobile: boolean
  stats: ProCalendarStatsDTO
  blockedMinutesToday: number
  autoAcceptBookings: boolean
  management: {
    todaysBookings: ProCalendarEventDTO[]
    pendingRequests: ProCalendarEventDTO[]
    waitlistToday: ProCalendarWaitlistEventDTO[]
    blockedToday: ProCalendarEventDTO[]
  }
}
