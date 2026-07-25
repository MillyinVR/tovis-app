// lib/availability/data/durationContext.ts

import { Prisma, ServiceLocationType } from '@prisma/client'

import { resolveDurationWithAddOns } from '@/lib/availability/data/addOnContext'
import {
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import {
  RESCHEDULE_TARGET_SELECT,
  resolveRescheduleCommitDurationMinutes,
} from '@/lib/booking/rescheduleWidth'
import { prisma } from '@/lib/prisma'

type AvailabilityDbClient = Prisma.TransactionClient | typeof prisma

/**
 * Who is asking, when the answer depends on a booking they own. `clientId` is
 * the viewer's CLIENT profile id — the route authenticates before calling, so
 * an unauthenticated request never reaches here with a booking id.
 */
export type RescheduleAvailabilityContext = {
  bookingId: string
  clientId: string
}

export type ResolveAvailabilityDurationArgs = {
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
  baseDurationMinutes: number
  reschedule: RescheduleAvailabilityContext | null
  client?: AvailabilityDbClient
}

export type ResolveAvailabilityDurationResult =
  | {
      ok: true
      durationMinutes: number
    }
  | {
      ok: false
      code: BookingErrorCode
      userMessage?: string
    }

/**
 * The minutes an availability answer must be computed for — the OFFER window.
 *
 * Two shapes, matching the two commits (B1-A, B3, B3-A):
 *  - a NEW booking commits `base + add-ons`, so the offer is sized from the
 *    selection;
 *  - a RESCHEDULE commits the booking's own `totalDurationMinutes`, which
 *    drifts from the offering's base the moment a pro edits a duration, so the
 *    offer must be sized from the BOOKING.
 *
 * Before B3-A the second case did not exist here and a reschedule was offered
 * base-sized starts, which the hold and the commit then refused — four dead-end
 * starts per working day on the B3 fixture. The width now comes from
 * `resolveRescheduleCommitDurationMinutes`, the same function the hold and the
 * commit run, so all three windows are one number
 * ([[offer-reserve-commit-are-three-windows]],
 * [[promise-site-runs-the-commit-site-gate]]).
 */
export async function resolveAvailabilityDurationMinutes(
  args: ResolveAvailabilityDurationArgs,
): Promise<ResolveAvailabilityDurationResult> {
  if (!args.reschedule) {
    const result = await resolveDurationWithAddOns({
      professionalId: args.professionalId,
      offeringId: args.offeringId,
      addOnIds: args.addOnIds,
      locationType: args.locationType,
      baseDurationMinutes: args.baseDurationMinutes,
      client: args.client,
    })

    return result.ok
      ? { ok: true, durationMinutes: result.durationMinutes }
      : {
          ok: false,
          code: result.code,
          userMessage: 'One or more add-ons are invalid for this offering.',
        }
  }

  // A reschedule keeps the booking's original add-ons — they are already inside
  // the committed width. Refusing rather than ignoring one of the two mirrors
  // `performLockedCreateHold`, so the offer and the reservation reject the same
  // request instead of quietly disagreeing about how wide the window is.
  if (args.addOnIds.length > 0) {
    return {
      ok: false,
      code: 'ADDONS_INVALID',
      userMessage:
        'Add-ons can’t be changed while moving this appointment. Pick a new time first.',
    }
  }

  const client = args.client ?? prisma

  const booking = await client.booking.findUnique({
    where: { id: args.reschedule.bookingId },
    select: RESCHEDULE_TARGET_SELECT,
  })

  // A missing booking and another client's booking answer identically, so the
  // shape of a refusal never reveals that someone else's booking exists — the
  // same anti-enumeration rule `lockClientOwnedBookingSchedule` and B3's hold
  // path follow.
  if (!booking || booking.clientId !== args.reschedule.clientId) {
    return { ok: false, code: 'BOOKING_NOT_FOUND' }
  }

  if (
    booking.professionalId !== args.professionalId ||
    booking.offeringId !== args.offeringId
  ) {
    return { ok: false, code: 'RESCHEDULE_BOOKING_MISMATCH' }
  }

  try {
    const { totalDurationMinutes } =
      resolveRescheduleCommitDurationMinutes(booking)

    return { ok: true, durationMinutes: totalDurationMinutes }
  } catch (error: unknown) {
    // The commit's own guards (cancelled/completed, already started, corrupt
    // duration) surface here as the refusal the reschedule itself would give,
    // rather than as a 500 — the client learns the booking is unmovable while
    // looking at the grid instead of after picking a time.
    if (isBookingError(error)) {
      return {
        ok: false,
        code: error.code,
        userMessage: error.userMessage,
      }
    }

    throw error
  }
}
