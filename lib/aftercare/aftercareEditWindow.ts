// lib/aftercare/aftercareEditWindow.ts
//
// Single source of truth for "is this COMPLETED booking's aftercare still
// editable?".
//
// Aftercare used to hard-lock the instant its booking reached COMPLETED, which
// made the lock land at an arbitrary moment: sending aftercare last completes
// the booking in that same write and locks it on the spot, while a booking
// whose payment is confirmed later stayed editable for however long that took.
// Either way the pro needs a correction window — a typo in the care notes, a
// product they meant to recommend — so a completed booking now stays editable
// for a bounded period and then closes for good (Tori, 2026-07-26).
//
// This answers ONLY the completed-booking question. Cancelled / not-yet-
// confirmed bookings, and the session-step gate, are separate refusals that run
// before this one in `performLockedUpsertBookingAftercare`; a non-COMPLETED
// booking is reported here as "no window applies", not as "safe to edit".
//
// Pure — no Prisma, no clock of its own — so the write boundary (the refusal),
// the pro aftercare page (the read-only render) and the pro aftercare API (so
// native renders the same state) all decide from the same function.
import { BookingStatus } from '@prisma/client'

/**
 * How long after completion a pro may still change their aftercare. Elapsed
 * duration from the completion instant, deliberately NOT calendar-day math:
 * there is no local midnight involved, so "30 days later" is 30×24h and needs
 * no timezone ([[local-day-arithmetic-not-24h]] is about local-day stepping,
 * which this is not).
 */
export const AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS = 30

const WINDOW_MS =
  AFTERCARE_POST_COMPLETION_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000

export type AftercareEditWindow = {
  /** May the pro still write to this aftercare? */
  editable: boolean
  /**
   * True once the booking is COMPLETED — i.e. a deadline exists and the editor
   * should say so. False while the booking is still live (no deadline yet).
   */
  isPostCompletion: boolean
  /** The instant editing shuts. Null while the booking isn't completed. */
  closesAt: Date | null
}

/**
 * Resolve the post-completion edit window for a booking's aftercare.
 *
 * The window is anchored on `finishedAt`, falling back to `scheduledFor` for
 * any legacy row that reached COMPLETED without one — an anchor we can always
 * produce beats leaving such a booking permanently editable. If neither yields
 * a usable instant we report the window as closed, so an unreadable clock
 * preserves the old locked-forever behavior rather than opening a write path.
 */
export function resolveAftercareEditWindow(args: {
  status: BookingStatus | null | undefined
  finishedAt: Date | null | undefined
  scheduledFor: Date | null | undefined
  now: Date
}): AftercareEditWindow {
  if (args.status !== BookingStatus.COMPLETED) {
    return { editable: true, isPostCompletion: false, closesAt: null }
  }

  const anchor = args.finishedAt ?? args.scheduledFor ?? null

  if (!anchor || Number.isNaN(anchor.getTime())) {
    return { editable: false, isPostCompletion: true, closesAt: null }
  }

  const closesAt = new Date(anchor.getTime() + WINDOW_MS)

  return {
    editable: args.now.getTime() < closesAt.getTime(),
    isPostCompletion: true,
    closesAt,
  }
}
