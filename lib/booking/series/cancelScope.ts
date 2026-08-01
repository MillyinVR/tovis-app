// lib/booking/series/cancelScope.ts
//
// K19 (Phase 8) — what a scoped series cancel is allowed to touch.
//
// The plan asks for three scopes in v1: *this one* / *this and future* / *all*.
// Only two of them live here. "This one" is the ordinary per-booking cancel
// (`PATCH /api/v1/pro/bookings/{id}`) and always was; giving it a second
// implementation shaped like a series would fork one behaviour into two.
//
// 🔴 The decision this file exists to write down: "all" CANNOT mean the same
// thing for an occurrence that already happened as for an untouched future one.
// A standing appointment is a plan, and a plan can only be cancelled forward.
// So a scoped cancel touches exactly the occurrences that have not happened yet
// — PENDING or ACCEPTED, never started, still in the future — and every other
// occurrence is REPORTED as untouched with the reason it was left alone. That
// list rides the success body, not an error: a caller that renders only what it
// cancelled tells the pro the series is gone when half of it is still standing.
//
// A future occurrence that has been PAID is still cancellable. Money is not a
// reason to trap the pro in an appointment nobody is attending — but cancelling
// does not refund (pro cancellation is pro discretion, `applyAutoCancelRefund`),
// so the amount collected is carried on every row the caller is about to touch
// and the confirm surface must say so before the pro commits
// ([[authorized-override-needs-visibility]]).
//
// One classifier, used by BOTH the read side (which renders "this would touch
// 7 of 12") and the write side (which does the touching). Two copies of this
// rule would let the preview and the write disagree, which is the exact defect
// class [[drifted-duplicate-is-a-bug-report]] describes.

import { BookingStatus } from '@prisma/client'

import type {
  ProBookingSeriesCancelScope,
  ProBookingSeriesUntouchedReason,
} from '@/lib/dto/proBookingSeries'

/** The occurrence facts the rule reads. Nothing else is consulted. */
export type SeriesOccurrenceCancelCandidate = {
  occurrenceIndex: number
  status: BookingStatus
  startedAt: Date | null
  scheduledFor: Date
}

export type SeriesOccurrenceCancelVerdict =
  | { cancellable: true }
  | { cancellable: false; reason: ProBookingSeriesUntouchedReason }

const CANCELLABLE_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
]

/**
 * Decide whether one occurrence is inside a scoped cancel.
 *
 * Scope is checked FIRST on purpose: the reason the pro is owed is "why did the
 * call I just made leave this alone", and for a row before `fromOccurrenceIndex`
 * the honest answer is the scope, whatever else is true of it.
 *
 * `now` is passed in rather than read — a "still in the future" rule that reads
 * the clock itself cannot be tested at a boundary.
 */
export function classifySeriesOccurrenceCancel(
  candidate: SeriesOccurrenceCancelCandidate,
  args: {
    scope: ProBookingSeriesCancelScope
    /** Required for THIS_AND_FUTURE; ignored for ALL. */
    fromOccurrenceIndex?: number | null
    now: Date
  },
): SeriesOccurrenceCancelVerdict {
  if (
    args.scope === 'THIS_AND_FUTURE' &&
    args.fromOccurrenceIndex != null &&
    candidate.occurrenceIndex < args.fromOccurrenceIndex
  ) {
    return { cancellable: false, reason: 'OUT_OF_SCOPE' }
  }

  if (candidate.status === BookingStatus.CANCELLED) {
    return { cancellable: false, reason: 'ALREADY_CANCELLED' }
  }

  if (
    candidate.status === BookingStatus.COMPLETED ||
    candidate.status === BookingStatus.NO_SHOW
  ) {
    return { cancellable: false, reason: 'ALREADY_HAPPENED' }
  }

  // A started session is checked BEFORE the status list so an IN_PROGRESS row
  // and an ACCEPTED-but-started row (the boundary stamps `startedAt` first)
  // give the same answer instead of falling through to a vaguer one.
  if (
    candidate.startedAt != null ||
    candidate.status === BookingStatus.IN_PROGRESS
  ) {
    return { cancellable: false, reason: 'IN_PROGRESS' }
  }

  if (!CANCELLABLE_STATUSES.includes(candidate.status)) {
    // Unreachable today — every BookingStatus is handled above. Kept so a new
    // status arrives as "left alone", never as a silent cancel.
    return { cancellable: false, reason: 'ALREADY_HAPPENED' }
  }

  if (candidate.scheduledFor.getTime() <= args.now.getTime()) {
    return { cancellable: false, reason: 'IN_PAST' }
  }

  return { cancellable: true }
}
