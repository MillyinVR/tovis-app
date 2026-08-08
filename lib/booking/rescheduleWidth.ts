// lib/booking/rescheduleWidth.ts

import { BookingStatus, Prisma } from '@prisma/client'

import {
  isClientRescheduleTooLate,
  MAX_SLOT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import { bookingError } from '@/lib/booking/errors'
import { clampInt } from '@/lib/pick'

/**
 * The floor a booking's committed width must clear to be reschedulable. A row
 * below it is corrupt rather than short, so it is refused instead of clamped.
 */
const MIN_RESCHEDULE_DURATION_MINUTES = 15

/**
 * The exact fields a reschedule's committed width is derived from. Kept as a
 * structural type rather than a Prisma payload so every caller can select only
 * what it needs: the commit site already holds the full booking row, the hold
 * and availability sites read only the columns below.
 */
export type RescheduleTargetRecord = {
  status: BookingStatus
  /** The instant the booking currently sits at — what the cutoff is measured from. */
  scheduledFor: Date
  startedAt: Date | null
  finishedAt: Date | null
  offeringId: string | null
  totalDurationMinutes: number | null
}

/**
 * Who is asking to move the booking. Only `CLIENT` is held to the cancellation
 * window — a pro moving their own calendar is not the arbitrage this guards, and
 * their write path (`updateProBooking`) carries explicit short-notice overrides.
 * Stated per call site rather than inferred, because the availability READ path
 * serves both roles from one function and a default would silently pick one.
 */
export type RescheduleActorKind = 'CLIENT' | 'PRO'

/**
 * THE width a reschedule will COMMIT for a booking, plus the guards that decide
 * whether it may be rescheduled at all.
 *
 * B3: the hold placed for a reschedule used to be sized from the OFFERING while
 * this is what `performLockedRescheduleBookingFromHold` takes — two numbers
 * nothing kept equal, so the reservation was routinely narrower than the commit
 * (on production, 7 of 11 live bookings, no add-ons involved). B3-A then found
 * the OFFER making the same mistake one layer earlier. All three windows now
 * call this one function, so none of them can promise a width another will not
 * honour, and the refusals are identical at every end
 * ([[promise-site-runs-the-commit-site-gate]],
 * [[offer-reserve-commit-are-three-windows]]).
 *
 * It lives here rather than in `writeBoundary` because the OFFER is a read
 * path: availability must be able to ask what the commit will take without
 * importing the write boundary.
 *
 * Throws the booking error the commit would throw; ownership is the caller's to
 * check first, because the sites reach the booking differently. Note this
 * moves the duration check AHEAD of the commit site's offering lookup: a booking
 * that is both corrupt-duration and missing its offering row now reports
 * `INVALID_DURATION` rather than `OFFERING_NOT_FOUND`. Both are 4xx refusals,
 * and validating the booking's own fields before a foreign lookup is the better
 * order. Returns the
 * offering id alongside the width so the commit site does not need a second,
 * unreachable null-check to narrow it.
 *
 * `args.actor` and `args.now` are both required rather than defaulted: the
 * cancellation-window cutoff below is a refusal, and a call site that forgot to
 * say who it speaks for should fail to compile instead of silently picking the
 * lenient branch.
 */
export function resolveRescheduleCommitDurationMinutes(
  booking: RescheduleTargetRecord,
  args: { now: Date; actor: RescheduleActorKind },
): { totalDurationMinutes: number; offeringId: string } {
  if (
    booking.status === BookingStatus.COMPLETED ||
    booking.status === BookingStatus.CANCELLED
  ) {
    throw bookingError('BOOKING_NOT_RESCHEDULABLE')
  }

  if (booking.startedAt || booking.finishedAt) {
    throw bookingError('BOOKING_ALREADY_STARTED')
  }

  // Inside the cancellation window a client may no longer move the appointment
  // themselves. Reschedule mutates `scheduledFor` on the SAME booking row, and
  // both refund rules re-read that column at cancel time — so without this a
  // client 2 hours out could push the booking a month forward and then cancel it
  // "in good time", converting a non-refundable late cancel into a full auto
  // refund (and, with a discovery deposit, dodging forfeiture). Measured from
  // where the booking sits NOW, not from the time being requested.
  //
  // Every one of the offer / reserve / commit windows reaches this function, so
  // the refusal is identical at all three rather than bolted onto the commit
  // where the availability grid would still have shown movable slots.
  // Client-only: a pro reaches this same function through the availability read
  // path, and holding them to the client's window would refuse a pro moving
  // their own short-notice booking ([[offer-reserve-commit-are-three-windows]]).
  if (
    args.actor === 'CLIENT' &&
    isClientRescheduleTooLate({
      scheduledFor: booking.scheduledFor,
      now: args.now,
    })
  ) {
    throw bookingError('BOOKING_RESCHEDULE_TOO_LATE')
  }

  const offeringId = booking.offeringId
  if (!offeringId) {
    throw bookingError('BOOKING_MISSING_OFFERING')
  }

  const rawDuration = Number(booking.totalDurationMinutes ?? 0)
  if (
    !Number.isFinite(rawDuration) ||
    rawDuration < MIN_RESCHEDULE_DURATION_MINUTES ||
    rawDuration > MAX_SLOT_DURATION_MINUTES
  ) {
    throw bookingError('INVALID_DURATION')
  }

  return {
    totalDurationMinutes: clampInt(
      Math.trunc(rawDuration),
      MIN_RESCHEDULE_DURATION_MINUTES,
      MAX_SLOT_DURATION_MINUTES,
    ),
    offeringId,
  }
}

/**
 * The columns `resolveRescheduleCommitDurationMinutes` reads, plus the two the
 * callers check ownership and offering identity with. Shared so the hold site
 * and the availability site cannot drift into selecting different rows.
 */
export const RESCHEDULE_TARGET_SELECT = {
  clientId: true,
  professionalId: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  finishedAt: true,
  offeringId: true,
  totalDurationMinutes: true,
} satisfies Prisma.BookingSelect
