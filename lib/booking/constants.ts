// lib/booking/constants.ts
import { BookingStatus } from '@prisma/client'

export const MAX_SLOT_DURATION_MINUTES = 12 * 60
export const MAX_BUFFER_MINUTES = 180
export const DEFAULT_DURATION_MINUTES = 60

export const MAX_OTHER_OVERLAP_MINUTES =
  MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES

export const MAX_ADVANCE_NOTICE_MINUTES = 24 * 60
export const MAX_DAYS_AHEAD = 3650
export const HOLD_MINUTES = 10

/**
 * How long a pro's waitlist offer stays live — and therefore how long its
 * BookingHold reserves the offered slot (F14).
 *
 * Deliberately NOT `HOLD_MINUTES`: a client-picked hold covers the seconds
 * between picking a slot and paying for it, while an offer is a push
 * notification the client may not see for hours. 24h is the default; the real
 * expiry is `min(now + this, startsAt − advanceNoticeMinutes)`, because past
 * that second the client's confirm would refuse ADVANCE_NOTICE_REQUIRED and the
 * offer is a promise nobody can accept.
 */
export const WAITLIST_OFFER_TTL_MINUTES = 24 * 60

/**
 * Names of the database GIST EXCLUDE constraints that durably forbid
 * overlapping scheduled ranges for a professional. Defined in the migrations
 * 20260522000000_add_booking_overlap_exclusion (bookings) and
 * 20260624010000_add_booking_hold_overlap_exclusion (holds). Exported so the
 * write boundary and integration tests can detect a violation without
 * hardcoding the literal in multiple places.
 */
export const BOOKING_OVERLAP_CONSTRAINT_NAME =
  'Booking_no_active_professional_overlap'
export const HOLD_OVERLAP_CONSTRAINT_NAME =
  'BookingHold_no_active_professional_overlap'

export const ALLOWED_STEP_MINUTES = [5, 10, 15, 20, 30, 60] as const

/**
 * Booking statuses that occupy a professional's calendar and therefore block
 * other bookings, holds, and last-minute openings from overlapping them.
 *
 * THE single source of truth. Every surface that asks "is the pro busy?" reads
 * this list — conflictQueries (the availability reads AND the write-boundary
 * overlap gate), the last-minute opening command, the pro busy-days route, and
 * the look-ranking availability aggregates — so the set can never drift between
 * paths.
 *
 * It matches the durable DB EXCLUDE predicate exactly (migration
 * 20260806000000); `booking-overlap-concurrency.test.ts` walks every
 * BookingStatus against real Postgres and fails if the two ever diverge, so a
 * status added to this array without a migration (or vice versa) is caught.
 *
 * COMPLETED is in the set by ruling (Tori, 2026-07-21): a finished appointment
 * still owns its time, because its buffer is the pro's cleanup/travel window
 * and `advanceNoticeMinutes` defaults to 15 — dropping it would let a client
 * book into that tail the moment the pro closed out. CANCELLED and NO_SHOW are
 * out: that time is genuinely free again. See F8 in
 * docs/design/scheduling-conflict-audit-fix-plan.md.
 *
 * A status array with this SHAPE but a different question behind it is not this
 * constant — e.g. `ESTABLISHED_BOOKING_STATUSES` (has this client booked here
 * before?) is also P/A/IP/COMPLETED and must NOT be folded in here.
 */
export const BOOKING_BLOCKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
]

// Temporary compat aliases while routes are migrated.
// Delete these once everything imports the canonical names above.
export const MAX_BOOKING_BUFFER_MINUTES = MAX_BUFFER_MINUTES
export const MAX_LOCATION_BUFFER_MINUTES = MAX_BUFFER_MINUTES