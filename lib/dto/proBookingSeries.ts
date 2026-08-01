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

import type { BookingSeriesExceptionReason } from '@prisma/client'

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
}
