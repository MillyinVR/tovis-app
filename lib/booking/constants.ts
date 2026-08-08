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
 * act to be treated as cancelling in good time.
 *
 * Two rules read it, and they have to read the SAME number or the pair opens a
 * hole. `isAutoCancelRefundEligible` (lib/booking/cancelRefund) auto-refunds a
 * client cancel only outside it; `resolveRescheduleCommitDurationMinutes`
 * (lib/booking/rescheduleWidth) refuses a client SELF-SERVE reschedule inside
 * it. Without the second rule a client 2 hours out could move the appointment a
 * month forward — reschedule mutates `scheduledFor` on the same booking row —
 * and then cancel it comfortably outside the window for a full auto-refund,
 * turning a non-refundable late cancel into a refunded one. The pro can still
 * move a booking at any notice via PATCH /api/v1/pro/bookings/[id]; this bounds
 * what the client may do unilaterally.
 *
 * It lives here rather than in cancelRefund so the availability READ path can
 * ask the question without importing the refund module's Stripe and Sentry
 * dependencies.
 */
export const CLIENT_FULL_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Whether a CLIENT is past the point of moving this booking themselves.
 *
 * The predicate lives beside the constant, and beside nothing else, so the
 * server guard (`resolveRescheduleCommitDurationMinutes`) and the UI that hides
 * the Reschedule button (`lifecycleActionViewModel`) cannot drift into
 * disagreeing about where the line is — a button offering something the commit
 * refuses is the failure this pair exists to avoid.
 *
 * Deliberately the exact complement of `isAutoCancelRefundEligible`: that one
 * refunds while `now <= scheduledFor - WINDOW`, this one refuses once
 * `now > scheduledFor - WINDOW`. On the boundary itself the client may still
 * both move the booking and cancel it for a refund.
 */
export function isClientRescheduleTooLate(args: {
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