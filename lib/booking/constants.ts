// lib/booking/constants.ts
import { BookingStatus } from '@prisma/client'

export const MAX_SLOT_DURATION_MINUTES = 12 * 60
export const MAX_BUFFER_MINUTES = 180
export const DEFAULT_DURATION_MINUTES = 60

export const MAX_OTHER_OVERLAP_MINUTES =
  MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES

/**
 * How far either side of a counted day-range an occupancy load must reach.
 *
 * An appointment that STARTS before the window (or ends after it) still eats
 * slots inside it, so every availability read pads its busy-interval query by
 * the widest an appointment plus its buffer can be. Numerically equal to
 * `MAX_OTHER_OVERLAP_MINUTES` but a different question — that one bounds how
 * far another booking may overlap; this one bounds a query window — so they get
 * separate names rather than one alias ([[same-shape-is-not-same-intent]]).
 *
 * Lived as four byte-identical local copies (the day / bootstrap / alternates
 * routes and the pro open-slot counter) before R4 consolidated them here.
 */
export const OCCUPANCY_WINDOW_PADDING_MINUTES =
  MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES

/**
 * Ceiling for a `?lead=` debug override on the availability routes — a month,
 * far past any real lead time, so a typo can't push every slot out of range.
 * Also the clamp `computeDaySlotsFast` applies to whatever it is handed.
 */
export const MAX_LEAD_MINUTES = 30 * 24 * 60

/**
 * The client cancellation window: how far ahead of the appointment a CLIENT must
 * act to count as acting in good time.
 *
 * Three rules read it and must read the SAME number. `isAutoCancelRefundEligible`
 * (lib/booking/cancelRefund) auto-refunds a client cancel only outside it; the
 * discovery-deposit refund keys off that same answer; and the reschedule commit
 * stamps `Booking.lateChangeAt` when a client moves a booking from inside it.
 *
 * It lives here rather than in cancelRefund so the pure and client-bundled
 * modules — the lifecycle view-model that writes the disclosure copy — can ask
 * the question without importing the refund module's Stripe and Sentry deps.
 */
export const CLIENT_FULL_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether `scheduledFor` is already inside the client cancellation window at
 * `now` — i.e. the client is acting late.
 *
 * The exact complement of the refund test: `isAutoCancelRefundEligible` refunds
 * while `now <= scheduledFor - WINDOW`, this returns true once
 * `now > scheduledFor - WINDOW`. On the boundary itself the client is still
 * early, so a cancel there refunds and a reschedule there is not a late change.
 *
 * Callers: the reschedule commit (does this move earn a `lateChangeAt` stamp?),
 * and the lifecycle view-model (does the Reschedule button need the late-change
 * warning?). Both must agree, or the client is warned about a penalty they do
 * not get — or worse, charged one they were never shown.
 */
export function isInsideClientCancellationWindow(args: {
  scheduledFor: Date
  now: Date
}): boolean {
  return (
    args.now.getTime() >
    args.scheduledFor.getTime() - CLIENT_FULL_REFUND_WINDOW_MS
  )
}

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