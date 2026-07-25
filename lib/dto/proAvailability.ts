// lib/dto/proAvailability.ts
//
// Wire DTO for the PRO's own occupancy overlay
// (GET /api/v1/pro/availability/busy-days) — the day buckets behind the
// aftercare rebook date pickers on both platforms (web
// `AvailabilityCalendarPopup`, iOS `ProRebookCalendarSheet`).
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
}

// GET /api/v1/pro/availability/busy-days success response. `days` is keyed by
// local "YYYY-MM-DD"; a day with nothing on it is OMITTED, not zero-filled.
export type ProAvailabilityBusyDaysOk = {
  ok: true
  /** The IANA zone the day buckets were computed in. */
  tz: string
  /** Echoed range, "YYYY-MM-DD" inclusive — `to` may be clamped by the server. */
  from: string
  to: string
  days: Record<string, ProBusyDayDTO>
}
