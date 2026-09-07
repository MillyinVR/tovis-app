// lib/consult/openWindow.ts
//
// P7a-3 — "is this consult still open for input?", asked once.
//
// Until this step a completed analysis run closed the consult: the lifecycle
// guard made COMPLETED terminal, every content window was pinned to
// MEDIA_READY, and the only thing that could still happen to a finished consult
// was revocation. The Sept 5 flow says the opposite — the consult is a living
// document until the appointment, every new input creates a revision, and
// "this run completed" is a fact about a RUN, not about the consult.
//
// So the closing condition moves from "the analysis finished" to "the
// appointment started", and this file owns that sentence for both anchors:
//
//   * BOOKING-anchored — the shipped rule, unchanged. `evaluateConsultAnchor`
//     already refuses a booking that is not upcoming or sits outside the pilot
//     window, and routing through it here keeps booking-attached consults
//     behaving exactly as they did (#1016 / iOS #375).
//
//   * LOOK-anchored (the spark) — 🔴 there was NO timing rule at all. The
//     anchor evaluator returns early for a look ("no scheduled time and no
//     booking status, so there is no window to apply"), and every booking-time
//     clause in the database is guarded by `ConsultSession."bookingId" IS NOT
//     NULL` — which a spark consult never sets. Its appointment hangs off
//     `Booking."sourceConsultSessionId"` (P7a-2), so that is where the rule has
//     to read from, and it could not be written before that link existed.
//
// The split this file also introduces: SCOPE (may this person see it) is not
// the INPUT WINDOW (may anything more be added). Reads take the first; writes
// take both. Before P7a-3 the stage loaders applied the booking window to
// READS as well, which is why a booking-anchored consult whose appointment had
// passed threw out of every loader — and, through `optionalStage`, took its own
// history off the screen.

import 'server-only'

import { BookingStatus, Prisma } from '@prisma/client'

import { addElapsedDays } from '@/lib/time'

import {
  CONSULT_ANCHOR_SELECT,
  evaluateConsultAnchor,
  evaluateConsultAnchorScope,
  type ConsultAnchorIneligibleReason,
} from './anchor'
import { ConsultWriteError } from './errors'

/**
 * How long a consult's raw captures outlive the appointment when the client
 * has opted into chart copy (Tori, Sept 5 2026).
 *
 * Fourteen days is the retention decision, not a technical constant: the pro
 * may still be writing up the visit, and a client who wants the plan reworked
 * after seeing the result has a fortnight in which her photos are still there
 * to rework it FROM. Without that consent the raw captures keep the 24h expiry
 * they have always had and a rerun needs a new photo.
 */
export const CONSULT_RETENTION_GRACE_DAYS = 14

/**
 * Bookings whose appointment is over or under way.
 *
 * IN_PROGRESS is in here because it is the literal meaning of "the appointment
 * has started" — the client is in the chair, and a plan that changes now is a
 * plan the pro is not looking at. COMPLETED for the same reason, one step
 * later.
 */
const APPOINTMENT_UNDER_WAY_STATUSES = new Set<BookingStatus>([
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
])

/**
 * Bookings that mean the appointment will NOT happen.
 *
 * These do not close the consult. A client whose booking was cancelled can
 * re-book the same look (`resolveConsultSparkLink` releases the link for
 * exactly these), and a consult she cannot add to is a consult she cannot
 * re-book from.
 */
const APPOINTMENT_ABANDONED_STATUSES = new Set<BookingStatus>([
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
])

const LINKED_BOOKING_SELECT = {
  id: true,
  status: true,
  scheduledFor: true,
  totalDurationMinutes: true,
} satisfies Prisma.BookingSelect

/**
 * Everything the input-window rule reads, on top of the anchor rule's own
 * select. Spread into a caller's select so a caller cannot forget a field.
 *
 * 🔴 `inspiredBookings` is deliberately NOT filtered by status. Filtering to
 * the live ones would make a COMPLETED booking disappear from the read, and a
 * consult whose appointment has just happened would look like one that was
 * never booked — open. The rule needs the booking whatever became of it.
 */
export const CONSULT_OPEN_WINDOW_SELECT = {
  ...CONSULT_ANCHOR_SELECT,
  booking: {
    select: {
      ...CONSULT_ANCHOR_SELECT.booking.select,
      ...LINKED_BOOKING_SELECT,
    },
  },
  inspiredBookings: {
    select: LINKED_BOOKING_SELECT,
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
} satisfies Prisma.ConsultSessionSelect

export type ConsultOpenWindowSession = Prisma.ConsultSessionGetPayload<{
  select: typeof CONSULT_OPEN_WINDOW_SELECT
}>

/** `APPOINTMENT_STARTED` is P7a-3's own; the rest come from the anchor rule. */
export type ConsultInputClosedReason =
  | ConsultAnchorIneligibleReason
  | 'APPOINTMENT_STARTED'

export type ConsultInputWindow =
  | { open: true }
  | { open: false; reason: ConsultInputClosedReason; hidden: boolean }

/**
 * The appointment this consult is being prepared for, whichever way it is
 * attached — the booking it was created from, or the one the spark CTA linked.
 *
 * One consult can never have both: `consult_session_scope_guard` requires
 * exactly one anchor, and `resolveConsultSparkLink` refuses to link a booking
 * to a consult that already has one of its own.
 */
export function consultLinkedBooking<
  TBooking extends Prisma.BookingGetPayload<{
    select: typeof LINKED_BOOKING_SELECT
  }>,
>(session: {
  bookingId: string | null
  booking: TBooking | null
  inspiredBookings: TBooking[]
}): TBooking | null {
  if (session.bookingId && session.booking) return session.booking
  return session.inspiredBookings[0] ?? null
}

/**
 * When this consult's raw captures may be purged, given chart-copy consent.
 *
 * The appointment plus its own duration plus the grace period — the end of the
 * visit, not its start, because a pro finishing a five-hour colour correction
 * is still inside the appointment the photos were taken for.
 *
 * Null means "no appointment to measure from" (not booked yet, or the booking
 * was cancelled). The caller keeps whatever expiry the capture already has:
 * this function only ever EXTENDS a life, and never invents one.
 */
export function consultCaptureRetentionExpiresAt(
  session: ConsultOpenWindowSession,
): Date | null {
  const booking = consultLinkedBooking(session)
  if (!booking || APPOINTMENT_ABANDONED_STATUSES.has(booking.status)) return null
  const endsAt = new Date(
    booking.scheduledFor.getTime() + booking.totalDurationMinutes * 60_000,
  )
  return addElapsedDays(endsAt, CONSULT_RETENTION_GRACE_DAYS)
}

/**
 * May anything more be ADDED to this consult right now?
 *
 * Scope first (ownership, the founder gate, the pilot vertical), then the
 * appointment. Reads must NOT call this — they take
 * `evaluateConsultAnchorScope` and their own readable-state set, because the
 * whole point of P7a-3 is that a consult which can no longer be changed can
 * still be read.
 */
export function resolveConsultInputWindow(
  session: ConsultOpenWindowSession,
  now = new Date(),
): ConsultInputWindow {
  const scope = evaluateConsultAnchorScope(session)
  if (!scope.eligible) {
    return { open: false, reason: scope.reason, hidden: scope.hidden }
  }

  const booking = consultLinkedBooking(session)

  // 🔴 The appointment question is asked FIRST, and identically for both
  // anchors. It has to be: "your appointment started" is one event, and a
  // booking-anchored consult answering it with the pilot's "unavailable for
  // this booking" while a spark consult answers it with its own sentence would
  // be two messages for one thing — which both clients would then have to
  // guess between, because they key their copy off the code.
  if (
    booking &&
    !APPOINTMENT_ABANDONED_STATUSES.has(booking.status) &&
    (APPOINTMENT_UNDER_WAY_STATUSES.has(booking.status) ||
      booking.scheduledFor.getTime() <= now.getTime())
  ) {
    // Visible, not hidden: she is allowed to know why. This is the ordinary end
    // of a consult's life, not a permission failure.
    return { open: false, reason: 'APPOINTMENT_STARTED', hidden: false }
  }

  // Everything ELSE about a booking anchor is the shipped rule verbatim — the
  // pilot's 90-day window, a declined booking, a cancelled one. Calling it
  // rather than re-deriving it is what keeps booking-attached consults
  // behaving exactly as they did (#1016 / iOS #375).
  if (scope.kind === 'BOOKING') {
    const anchor = evaluateConsultAnchor(session, now)
    return anchor.eligible
      ? { open: true }
      : { open: false, reason: anchor.reason, hidden: anchor.hidden }
  }

  // A LOOK anchor with no live appointment. Not booked yet, or booked and then
  // cancelled — the spark's whole point is that prep happens on both sides of
  // the Book button, and a client whose booking fell through must be able to
  // re-book from the same consult (`resolveConsultSparkLink` releases the link
  // for exactly those statuses).
  return { open: true }
}

/**
 * Scope, for a READ. Ownership, the founder gate, the pilot vertical — and
 * deliberately no timing rule at all.
 *
 * 🔴 This is the half of P7a-3 that stops the thread eating its own history.
 * Every stage loader used to apply the booking WINDOW as well, so a consult
 * whose appointment had passed threw `BOOKING_INELIGIBLE` out of intake,
 * capture and analysis alike — and `loadConsultThread`'s `optionalStage`
 * rendered each one as "this stage never happened". A consult that can no
 * longer be CHANGED must still be READ; those are two questions and this file
 * now answers them separately.
 */
export function assertConsultReadableScope(
  session: ConsultOpenWindowSession,
): void {
  const scope = evaluateConsultAnchorScope(session)
  if (scope.eligible) return
  throw new ConsultWriteError(
    scope.hidden ? 'NOT_FOUND' : 'BOOKING_INELIGIBLE',
    'Consult is unavailable for this booking.',
  )
}

/**
 * Scope plus the appointment, for a WRITE.
 *
 * `APPOINTMENT_STARTED` gets its own code rather than reusing
 * BOOKING_INELIGIBLE: the pilot's scope refusal means "unavailable", and this
 * one means "this went perfectly and it is over now". Both clients key their
 * copy off the code, so one shared code would make them say the same wrong
 * thing on two very different days.
 */
export function assertConsultInputOpen(
  session: ConsultOpenWindowSession,
  now = new Date(),
): void {
  const window = resolveConsultInputWindow(session, now)
  if (window.open) return
  if (window.reason === 'APPOINTMENT_STARTED') {
    throw new ConsultWriteError(
      'APPOINTMENT_STARTED',
      'This consult closed when the appointment started.',
    )
  }
  throw new ConsultWriteError(
    window.hidden ? 'NOT_FOUND' : 'BOOKING_INELIGIBLE',
    'Consult is unavailable for this booking.',
  )
}
