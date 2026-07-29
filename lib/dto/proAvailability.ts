// lib/dto/proAvailability.ts
//
// Wire DTO for the PRO's own occupancy overlay
// (GET /api/v1/pro/availability/busy-days) — the day buckets behind every
// pro-facing date picker on both platforms (web
// `app/pro/_components/AvailabilityCalendar`, iOS `ProRebookCalendarView`).
//
// Service-agnostic and cross-location by design: it answers "which days am I
// already committed on", not "can this service be booked here" (that is
// /api/v1/availability/*). JSON-safe throughout — counts, booleans and
// "YYYY-MM-DD" strings, no Decimal/Date reaches the wire type.

/** One calendar day's commitments in the requested timezone. */
export type ProBusyDayDTO = {
  /** Occupying bookings (BOOKING_BLOCKING_STATUSES) starting that local day. */
  bookings: number
  /** Whether a calendar block touches that local day. */
  blocked: boolean
  /**
   * Bookable START TIMES left on that local day for the service the request
   * named — "can I still fit someone in", as opposed to the two fields above,
   * which only say how full the day already is (R4).
   *
   * Present ONLY when `openSlots.computed` is true on the envelope, and then on
   * EVERY day in range including zeroes — a fully-booked day and a day the
   * server never counted must not look alike. Read the envelope first; don't
   * infer "unknown" from a missing key here.
   */
  openSlots?: number
}

/**
 * Describes the open-slot overlay: whether it was computed, for what, and why
 * not when it wasn't.
 *
 * Always present on the envelope so a consumer can distinguish the three states
 * explicitly instead of guessing from an absent field
 * ([[optional-field-hides-a-required-one]]).
 */
export type ProOpenSlotContextDTO = {
  /** True when every day in [from, to] carries an `openSlots` count. */
  computed: boolean
  /**
   * The appointment width the counts were computed for. A reschedule is sized
   * from the BOOKING, everything else from the offering plus its add-ons, so
   * this is echoed rather than assumed. Null when nothing was computed.
   */
  durationMinutes: number | null
  /**
   * Why counts are missing, when `computed` is false — a booking error code
   * (e.g. "WORKING_HOURS_REQUIRED") or "SERVICE_NOT_FOUND". Null on success.
   * For display, treat it as a reason to hide the overlay, not to fail: the
   * day picker still works without counts.
   */
  reason: string | null
}

// GET /api/v1/pro/availability/busy-days success response. `days` is keyed by
// local "YYYY-MM-DD".
//
// Density depends on the mode. Busy-only (no service context requested): a day
// with nothing on it is OMITTED. With open-slot counts computed: EVERY day in
// range is present, because a zero count is information.
export type ProAvailabilityBusyDaysOk = {
  ok: true
  /** The IANA zone the day buckets were computed in. */
  tz: string
  /** Echoed range, "YYYY-MM-DD" inclusive — `to` may be clamped by the server. */
  from: string
  to: string
  days: Record<string, ProBusyDayDTO>
  /**
   * The open-slot overlay's state. `null` when the request carried no service
   * context at all — the classic "which days am I busy" call.
   */
  openSlots: ProOpenSlotContextDTO | null
}
