// The recurring-appointment wire contract — POST /api/v1/pro/booking-series.
//
// K18 (Phase 8). The series is the RULE; what it produces are ordinary bookings.
// That is why this response leads with the appointments, not with the pattern:
// the pro who just created a standing appointment needs to know WHICH dates were
// actually booked, and — the part no other create route has to say — which ones
// were not.
//
// 🔴 `skipped` is a first-class part of the contract, never an error. A
// collision on one occurrence skips that occurrence and leaves the rest of the
// series standing, so a 201 can legitimately carry eleven bookings and one skip.
// A client that renders only `occurrences` is quietly telling the pro they got
// twelve appointments when they got eleven.

import type {
  BookingSeriesExceptionReason,
  BookingSeriesStatus,
  BookingStatus,
} from '@prisma/client'

/** One appointment the materializer actually created. */
export type ProBookingSeriesOccurrenceDTO = {
  /** 0-based and stable. Index 0 is the slot the pro picked. */
  index: number
  bookingId: string
  /** UTC instant, ISO-8601. Render it in `timeZone`. */
  scheduledFor: string
}

/** One occurrence the materializer did NOT create, and why. */
export type ProBookingSeriesSkippedOccurrenceDTO = {
  index: number
  /**
   * The instant the occurrence wanted, ISO-8601 — or null for
   * NONEXISTENT_LOCAL_TIME, where no such instant exists (a DST gap). `detail`
   * then carries the wall clock that does not exist.
   */
  intendedStart: string | null
  reason: BookingSeriesExceptionReason
  /**
   * The BookingErrorCode that refused it, or the impossible wall-clock time.
   * Diagnostic, not user copy.
   */
  detail: string | null
}

/**
 * K20 — why creation stopped SHORT of the requested run, when it did.
 *
 * 🔴 Not a skip. A skip is permanent (`BookingSeriesException` is unique per
 * index, so the roll-forward never retries it); this is a "not yet" that leaves
 * no row behind and WILL be retried — today, a date past the pro's own booking
 * horizon. Before K20 those became permanent `REFUSED` exceptions, which quietly
 * made every series longer than the pro's booking window permanently short.
 */
export type ProBookingSeriesDeferralDTO = {
  /** The first index this pass did not attempt. */
  index: number
  /** The instant it would have taken, ISO-8601. */
  intendedStart: string | null
  /** `BEYOND_WINDOW`, or the BookingErrorCode that deferred it. Diagnostic. */
  code: string
}

export type ProBookingSeriesCreateResponseDTO = {
  seriesId: string
  /**
   * The zone the pattern steps through — the LOCATION's, not the viewer's.
   * "Every Friday 9am" is 9am there, so every date above must be rendered in
   * this zone or the pro reads a different day near midnight.
   */
  timeZone: string
  /**
   * Where K20's roll-forward resumes. Also the honest count of occurrences
   * ATTEMPTED so far: occurrences.length + skipped.length.
   */
  nextOccurrenceIndex: number
  occurrences: ProBookingSeriesOccurrenceDTO[]
  skipped: ProBookingSeriesSkippedOccurrenceDTO[]
  /**
   * Set when creation stopped before the requested run was exhausted. Null means
   * it attempted everything this pass was asked to attempt. The remaining dates
   * are neither booked nor lost — the roll-forward adds them as they come into
   * range.
   */
  deferred: ProBookingSeriesDeferralDTO | null
}

// ── K19: reading a series back, and stopping it ───────────────────────────────
//
// The create response above is WRITE-ONLY — it describes what one call did. The
// pro needs the standing state: which dates are still booked, which were skipped
// (the exception rows, the durable form of the same `skipped` list), and what a
// scoped cancel would actually touch.

/**
 * Why a scoped cancel left an occurrence alone. The list is the point: "cancel
 * all" cannot mean the same thing for a visit that already happened as for an
 * untouched future one, so every untouched row says which it was.
 */
export type ProBookingSeriesUntouchedReason =
  /** Already cancelled — nothing to do. */
  | 'ALREADY_CANCELLED'
  /** The appointment happened (COMPLETED / NO_SHOW). History, not a plan. */
  | 'ALREADY_HAPPENED'
  /** The session has been started. Cancelling mid-visit is not a bulk action. */
  | 'IN_PROGRESS'
  /** Scheduled in the past and never started. Left as the record it is. */
  | 'IN_PAST'
  /** Outside the chosen scope (an earlier occurrence under THIS_AND_FUTURE). */
  | 'OUT_OF_SCOPE'

export type ProBookingSeriesOccurrenceDetailDTO = {
  index: number
  bookingId: string
  /** UTC instant, ISO-8601. Render it in the series `timeZone`. */
  scheduledFor: string
  status: BookingStatus
  startedAt: string | null
  /**
   * The service subtotal this occurrence was actually booked at, in cents —
   * `Booking.subtotalSnapshot`. Occurrence 0's value is the series' PINNED
   * price; a later occurrence that disagrees is price drift the pro is owed a
   * sight of, not a rounding detail.
   */
  bookedTotalCents: number | null
  /**
   * Deposit money actually still held for this occurrence, in cents
   * (`deriveNetDepositHeldCents` — net of refunds, zero while disputed). NOT a
   * bill: a future occurrence has no final total yet. It is here because a
   * scoped cancel does not refund, so the pro must see what they are holding
   * before they cancel it away.
   */
  depositHeldCents: number
  /**
   * True when a scoped cancel would transition this row. False rows carry
   * `untouchedReason`.
   */
  cancellable: boolean
  untouchedReason: ProBookingSeriesUntouchedReason | null
}

/**
 * Price pinning (plan §Phase 8): the series is priced by what occurrence 0 was
 * booked at, and drift is SURFACED rather than silently applied.
 */
export type ProBookingSeriesPricingDTO = {
  /** Occurrence 0's booked service subtotal, in cents. The pin. */
  pinnedTotalCents: number | null
  /**
   * The pro's CURRENT list price for this offering in this location mode plus
   * the series' add-ons, in cents. Deliberately the catalog figure and labelled
   * as such: what a given client is actually charged can differ (a price-grace
   * ramp), so this is a comparison the pro can act on, never a prediction of
   * the client's next bill.
   */
  currentListTotalCents: number | null
  /** True when a materialized occurrence disagrees with the pin. */
  occurrencesDisagree: boolean
  /**
   * True when `currentListTotalCents` differs from `pinnedTotalCents`.
   *
   * 🔴 K20 settled what this MEANS, and it is not "your next occurrence will
   * cost this": the roll-forward books every later occurrence at
   * `pinnedTotalCents`, so a moved list price is information about the gap, and
   * the pro's remedy is to end the series and start a new one. See
   * lib/booking/series/pinnedPrice.ts. Any surface rendering this must say which
   * of the two numbers the client will actually be charged.
   */
  listPriceMoved: boolean
}

/**
 * K20 — whether this series still grows, and how far ahead.
 *
 * A standing appointment that stops producing dates is the failure K18-B named
 * and K19 refused to sell. This is the honest statement of the opposite: the
 * dates the pro has NOT been shown yet, and the fact that something will create
 * them.
 */
export type ProBookingSeriesRollForwardDTO = {
  /**
   * True when the roll-forward will add more dates to this series.
   *
   * 🔴 False whenever the roll-forward cannot actually run — an ENDED or
   * CANCELLED series, a plan with nothing left, and (the one that is easy to
   * miss) the recurring-appointments feature being switched off. A surface that
   * promised "new dates are added automatically" while the operator was dark
   * would be the exact defect K19 refused to ship
   * ([[verifiable-rail-still-needs-an-operator]]).
   */
  willContinue: boolean
  /**
   * Planned occurrences not yet attempted, or null for an open-ended series
   * (which has no total to count down from).
   */
  pendingCount: number | null
  /** How far ahead of today the roll-forward keeps a series booked, in days. */
  leadDays: number
}

export type ProBookingSeriesDetailDTO = {
  seriesId: string
  status: BookingSeriesStatus
  /** The zone the pattern steps through — the LOCATION's. */
  timeZone: string
  /** Occurrence 0's UTC instant, ISO-8601. */
  anchorAt: string
  intervalWeeks: number
  /** Planned total, or null for an open-ended series. */
  occurrenceCount: number | null
  nextOccurrenceIndex: number
  depositRequested: boolean
  depositPerOccurrence: boolean
  clientId: string
  clientName: string
  offeringId: string
  serviceName: string
  locationId: string
  locationLabel: string
  locationType: 'SALON' | 'MOBILE'
  addOnNames: string[]
  internalNotes: string | null
  pricing: ProBookingSeriesPricingDTO
  rollForward: ProBookingSeriesRollForwardDTO
  occurrences: ProBookingSeriesOccurrenceDetailDTO[]
  /** The durable skips — `BookingSeriesException` rows, oldest index first. */
  skipped: ProBookingSeriesSkippedOccurrenceDTO[]
}

/**
 * Cancel scope. "This one" is deliberately ABSENT: it is the ordinary
 * per-booking cancel (`PATCH /api/v1/pro/bookings/{id}`) and routing it through
 * a series-shaped endpoint would fork one behaviour into two implementations.
 */
export type ProBookingSeriesCancelScope = 'THIS_AND_FUTURE' | 'ALL'

export type ProBookingSeriesCancelledOccurrenceDTO = {
  index: number
  bookingId: string
  scheduledFor: string
  /** Deposit money held against it. Cancelling does NOT refund it. */
  depositHeldCents: number
}

export type ProBookingSeriesUntouchedOccurrenceDTO = {
  index: number
  bookingId: string
  scheduledFor: string
  status: BookingStatus
  reason: ProBookingSeriesUntouchedReason
}

export type ProBookingSeriesCancelResponseDTO = {
  seriesId: string
  scope: ProBookingSeriesCancelScope
  seriesStatus: BookingSeriesStatus
  /** Rows this call transitioned to CANCELLED. */
  cancelled: ProBookingSeriesCancelledOccurrenceDTO[]
  /**
   * Rows it deliberately did NOT touch, each with the reason. Reported on the
   * SUCCESS body for the same reason `skipped` is on the create body: a caller
   * that renders only `cancelled` tells the pro the series is gone when part of
   * it is still standing.
   */
  untouched: ProBookingSeriesUntouchedOccurrenceDTO[]
}
