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
 * Single source of truth — used by conflictQueries (both the availability reads
 * and the write-boundary overlap gate) and the last-minute opening command, so
 * the set can never drift between paths.
 *
 * NOTE this set is stricter than the durable DB EXCLUDE predicate, which covers
 * PENDING/ACCEPTED/IN_PROGRESS only — COMPLETED is deliberately excluded there
 * (pinned by booking-overlap-concurrency.test.ts). See F8 in
 * docs/design/scheduling-conflict-audit-fix-plan.md.
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