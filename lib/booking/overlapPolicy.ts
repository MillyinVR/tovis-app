// lib/booking/overlapPolicy.ts

import type { ServiceLocationType } from '@prisma/client'

/**
 * Whether THIS attempt can be stopped and asked about a live client hold.
 *
 * B5 let a pro overlap any conflict with no friction at all, which is right for
 * another appointment — a pro double-booking their own book is their call — and
 * wrong for a client who is mid-checkout on those exact minutes. Tori's call
 * (2026-08-28): show the pro who is holding it (new or returning, and nothing
 * else) and let them decide, rather than taking the slot out from under a
 * payment in progress.
 *
 * REQUIRED, with no default, on purpose. A default would make every future pro
 * write path silently inherit one of these answers, and the wrong one is
 * invisible: `NO_DECISION_SURFACE` books straight over a live checkout in
 * silence, exactly the behaviour this exists to end
 * ([[a-decision-leaves-its-old-defaults-behind]]). Making it a required field
 * means the compiler asks every new call site the question.
 */
export type ProLiveHoldOverlapStance =
  /**
   * An interactive surface that CAN show the decision and has not yet. A live
   * hold in the way refuses with `PRO_HOLD_DECISION_REQUIRED`.
   */
  | 'ASK_THE_PRO'
  /**
   * The pro was shown the decision for this slot and chose to proceed. Books
   * exactly as `PRO_AUTHORIZED_OVERLAP` does, and is LOGGED as an informed
   * choice.
   */
  | 'PRO_CONFIRMED'
  /**
   * There is no surface here that could ask — the aftercare-save reschedule,
   * the calendar import, a series occurrence. Today's behaviour, unchanged: the
   * pro's authority stands and a hold does not stop the write. Never reach for
   * this on a path a pro is watching.
   */
  | 'NO_DECISION_SURFACE'

export type BookingOverlapActor =
  | {
      kind: 'CLIENT'
      userId: string
      clientId: string
    }
  | {
      kind: 'PRO'
      userId: string
      professionalId: string
      liveHoldOverlap: ProLiveHoldOverlapStance
    }
  | {
      kind: 'ADMIN'
      userId: string
    }

export type BookingWindow = {
  professionalId: string
  startsAt: Date
  endsAt: Date
}

export type SchedulingConflictKind = 'BOOKING' | 'HOLD'

type SchedulingConflictBase = {
  id: string
  professionalId: string
  startsAt: Date
  endsAt: Date
}

/**
 * One thing already sitting on the requested minutes.
 *
 * A discriminated union rather than a `kind` field on one shape, because a HOLD
 * carries something a BOOKING has no equivalent of: the instant it lapses. The
 * live-hold decision below has to know whether the reservation in the way is
 * still running, and reading that off the conflict makes it a fact the type
 * carries rather than a promise the caller's query made in a comment.
 */
export type SchedulingConflict =
  | ({ kind: 'BOOKING' } & SchedulingConflictBase)
  | ({
      kind: 'HOLD'
      /** When the client's checkout reservation lapses (`BookingHold.expiresAt`). */
      expiresAt: Date
    } & SchedulingConflictBase)

/** The live (unexpired) holds among a conflict list, at `now`. */
export function liveHoldConflicts(
  conflicts: readonly SchedulingConflict[],
  now: Date,
): SchedulingConflict[] {
  return conflicts.filter(
    (conflict) =>
      conflict.kind === 'HOLD' && conflict.expiresAt.getTime() > now.getTime(),
  )
}

export type ProPreselectedAftercareSlot = {
  aftercareSummaryId: string
  clientActionTokenId: string
  professionalId: string
  offeringId: string | null
  locationId: string
  locationType: ServiceLocationType
  startsAt: Date
  endsAt: Date
}

export type BookingOverlapSource =
  | {
      kind: 'BROAD_DISCOVERY'
    }
  | {
      kind: 'DIRECT_PROFILE'
    }
  | {
      kind: 'SPECIFIC_SEARCH'
    }
  | {
      kind: 'NFC_CARD'
    }
  | {
      kind: 'PRO_CREATED'
    }
  | {
      kind: 'ADMIN_OVERRIDE'
    }
  | {
      kind: 'CALENDAR_IMPORT'
    }
  | {
      kind: 'SERIES_MATERIALIZATION'
    }
  | {
      kind: 'AFTERCARE_REBOOK'
      aftercareSummaryId: string
      clientActionTokenId: string
      proPreselectedSlot: ProPreselectedAftercareSlot | null
    }

export type BookingOverlapAllowedMode =
  | 'NO_OVERLAP'
  | 'PRO_AUTHORIZED_OVERLAP'
  /**
   * A pro who was SHOWN a live client hold on these minutes and chose to take
   * them anyway. Functionally identical to `PRO_AUTHORIZED_OVERLAP` — same
   * write, same `allowsOverlap` exemption — and kept as its own mode because
   * the audit trail has to be able to say the choice was informed.
   */
  | 'PRO_CONFIRMED_HOLD_OVERLAP'
  | 'ADMIN_AUTHORIZED_OVERLAP'

export type BookingOverlapBlockedCode =
  | 'CLIENT_OVERLAP_NOT_ALLOWED'
  /**
   * Not a refusal — a question. A live client hold is on these minutes and the
   * pro has not been asked yet. The caller answers by putting the decision in
   * front of them and re-submitting with `liveHoldOverlap: 'PRO_CONFIRMED'`.
   */
  | 'PRO_HOLD_DECISION_REQUIRED'
  | 'IMPORT_OVERLAP_NOT_ALLOWED'
  | 'SERIES_OVERLAP_NOT_ALLOWED'
  | 'AFTERCARE_PRESELECTED_SLOT_REQUIRED'
  | 'AFTERCARE_PRESELECTED_SLOT_MISMATCH'
  | 'INVALID_BOOKING_WINDOW'

export type BookingOverlapDecision =
  | {
      ok: true
      mode: BookingOverlapAllowedMode
      conflicts: SchedulingConflict[]
    }
  | {
      ok: false
      code: BookingOverlapBlockedCode
      userMessage: string
      conflicts: SchedulingConflict[]
    }

export function hasSchedulingConflicts(
  conflicts: readonly SchedulingConflict[],
): boolean {
  return conflicts.length > 0
}

export function isValidBookingWindow(window: BookingWindow): boolean {
  const startsAtMs = window.startsAt.getTime()
  const endsAtMs = window.endsAt.getTime()

  return (
    window.professionalId.trim().length > 0 &&
    Number.isFinite(startsAtMs) &&
    Number.isFinite(endsAtMs) &&
    startsAtMs < endsAtMs
  )
}

export function decideBookingOverlapPermission(args: {
  actor: BookingOverlapActor
  source: BookingOverlapSource
  requestedWindow: BookingWindow
  conflicts: readonly SchedulingConflict[]
  /**
   * The instant this decision is being made at. Used for ONE thing: telling a
   * live client hold from a lapsed one. Required rather than defaulted to
   * `new Date()` so the whole function stays clock-free and the write boundary's
   * transaction clock is the one that decides.
   */
  now: Date
}): BookingOverlapDecision {
  const conflicts = [...args.conflicts]

  if (!isValidBookingWindow(args.requestedWindow)) {
    return {
      ok: false,
      code: 'INVALID_BOOKING_WINDOW',
      userMessage: 'That appointment time is invalid. Please choose another time.',
      conflicts,
    }
  }

  if (!hasSchedulingConflicts(conflicts)) {
    return {
      ok: true,
      mode: 'NO_OVERLAP',
      conflicts,
    }
  }

  // A calendar import runs unattended — the interactive commit walks a whole ICS
  // feed, and the resync cron re-walks it hourly from a remote URL. No human is
  // looking at this slot and choosing to double-book, so a conflict here is
  // never an authorized overlap even though the actor is the pro. Refusing
  // before the PRO/ADMIN branches is deliberate: this is a property of the
  // SOURCE, not of who is holding the pen. The importer catches this and holds
  // the time as a calendar block for the pro to review instead — never dropping
  // the event, and never silently stacking it on a real appointment.
  if (args.source.kind === 'CALENDAR_IMPORT') {
    return {
      ok: false,
      code: 'IMPORT_OVERLAP_NOT_ALLOWED',
      userMessage:
        'That time is already booked. The imported appointment was held as blocked time for you to review.',
      conflicts,
    }
  }

  // K18: a recurring occurrence is materialized unattended — the pro chose a
  // PATTERN months ago, not this slot on this date, and K20's cron re-runs the
  // same code with nobody at the keyboard at all. So a conflict here is never an
  // authorized overlap even though the actor is the pro, for exactly the reason
  // CALENDAR_IMPORT is refused above: it is a property of the SOURCE, not of who
  // is holding the pen. The materializer catches this, records the occurrence as
  // a skipped exception and carries on with the rest of the series — it never
  // drops the series, and it never silently stacks a standing appointment on top
  // of a real one.
  //
  // 🔴 Without this branch the PRO branch below returns PRO_AUTHORIZED_OVERLAP,
  // which sets Booking.allowsOverlap and exempts the row from the DB overlap
  // constraint. Every collision in a twelve-week series would double-book in
  // silence, and the "skip + notify" policy would have no way to fire.
  if (args.source.kind === 'SERIES_MATERIALIZATION') {
    return {
      ok: false,
      code: 'SERIES_OVERLAP_NOT_ALLOWED',
      userMessage:
        'That time is already booked, so this appointment in the series was skipped.',
      conflicts,
    }
  }

  if (args.actor.kind === 'PRO') {
    // B5's rule, unchanged: a pro may sit an appointment on top of another
    // appointment. That is their book, and nobody else is mid-transaction on it.
    //
    // The one exception (Tori, 2026-08-28) is a LIVE client hold — somebody is
    // on the checkout screen paying for these exact minutes right now. Taking
    // them silently is what this branch used to do; now the pro is shown who is
    // holding it (new or returning to them, and nothing else) and decides.
    //
    // Scoped strictly to holds that are still RUNNING. A lapsed hold reserves
    // nothing — every conflict query already filters `expiresAt > now`, so one
    // normally cannot even reach here — and a booking-vs-booking conflict is
    // untouched, so no friction is added anywhere it was not asked for.
    const liveHolds = liveHoldConflicts(conflicts, args.now)

    if (liveHolds.length > 0 && args.actor.liveHoldOverlap !== 'NO_DECISION_SURFACE') {
      if (args.actor.liveHoldOverlap === 'ASK_THE_PRO') {
        return {
          ok: false,
          code: 'PRO_HOLD_DECISION_REQUIRED',
          userMessage:
            'A client is checking out for this time right now. Choose whether to book over them.',
          conflicts,
        }
      }

      return {
        ok: true,
        mode: 'PRO_CONFIRMED_HOLD_OVERLAP',
        conflicts,
      }
    }

    return {
      ok: true,
      mode: 'PRO_AUTHORIZED_OVERLAP',
      conflicts,
    }
  }

  if (args.actor.kind === 'ADMIN') {
    return {
      ok: true,
      mode: 'ADMIN_AUTHORIZED_OVERLAP',
      conflicts,
    }
  }

  if (args.source.kind === 'AFTERCARE_REBOOK') {
    const slot = args.source.proPreselectedSlot

    if (!slot) {
      return {
        ok: false,
        code: 'AFTERCARE_PRESELECTED_SLOT_REQUIRED',
        userMessage:
          'That time is no longer available. Please choose another time.',
        conflicts,
      }
    }

    // The pro's pre-selected slot no longer authorizes booking over a
    // conflict: BOOKED-mode aftercare creates the real next appointment at
    // save time, so a live proposal's slot cannot be taken out from under the
    // client. A conflict here — legacy proposals included — therefore always
    // means the time has since been taken; the honest answer on every surface
    // (in-app confirm card and public aftercare link alike) is "taken, pick
    // another", never a silent double-book.
    return {
      ok: false,
      code: 'AFTERCARE_PRESELECTED_SLOT_MISMATCH',
      userMessage:
        'That time is no longer available. Please pick a different time.',
      conflicts,
    }
  }

  return {
    ok: false,
    code: 'CLIENT_OVERLAP_NOT_ALLOWED',
    userMessage: 'That time is no longer available. Please choose another time.',
    conflicts,
  }
}