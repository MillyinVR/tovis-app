// lib/availability/data/durationContext.ts

import { Prisma, ServiceLocationType } from '@prisma/client'

import { resolveDurationWithAddOns } from '@/lib/availability/data/addOnContext'
import {
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import {
  REBOOK_SOURCE_WIDTH_SELECT,
  type RebookSourceWidthRow,
  computeRebookCloneDurationMinutes,
} from '@/lib/booking/rebookWidth'
import {
  RESCHEDULE_TARGET_SELECT,
  resolveRescheduleCommitDurationMinutes,
} from '@/lib/booking/rescheduleWidth'
import { prisma } from '@/lib/prisma'

type AvailabilityDbClient = Prisma.TransactionClient | typeof prisma

/**
 * Whose booking the reschedule belongs to. The route authenticates before
 * calling, so an unauthenticated request never reaches here with a booking id.
 *
 * Two shapes because both sides of the app reschedule: the client grid keys
 * ownership on the viewer's CLIENT profile, while the pro-facing open-slot
 * count (R4) keys it on the PROFESSIONAL. Everything after the ownership check
 * — the add-on refusal, the offering-identity check, the committed width — is
 * identical, which is exactly why this is one parameter rather than two copies
 * of the function ([[drifted-duplicate-is-a-bug-report]]).
 */
export type RescheduleAvailabilityOwner =
  | { kind: 'CLIENT'; clientId: string }
  | { kind: 'PRO'; professionalId: string }

/**
 * Who is asking, when the answer depends on a booking they own.
 */
export type RescheduleAvailabilityContext = {
  bookingId: string
  owner: RescheduleAvailabilityOwner
}

export type ResolveAvailabilityDurationArgs = {
  professionalId: string
  offeringId: string
  addOnIds: string[]
  locationType: ServiceLocationType
  baseDurationMinutes: number
  reschedule: RescheduleAvailabilityContext | null
  /**
   * Set when the answer sizes an AFTERCARE REBOOK of this booking. The rebook
   * commit clones the source booking's service items — base plus add-ons, at
   * snapshot durations — so the offer must be that wide too, not offering-base
   * wide. Same ownership shape as `reschedule`; mutually exclusive with it.
   */
  rebookOf?: RescheduleAvailabilityContext | null
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
  if (args.rebookOf && args.reschedule) {
    // One request cannot be both a move of an existing booking and a clone of
    // a finished one — the two size differently and discount occupancy
    // differently. Refuse rather than pick one.
    return {
      ok: false,
      code: 'INVALID_AVAILABILITY_CONTEXT',
      userMessage: 'This request mixes a reschedule with a rebook.',
    }
  }

  if (args.rebookOf) {
    return resolveRebookOfDurationMinutes(args, args.rebookOf)
  }

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

  // A missing booking and someone else's booking answer identically, so the
  // shape of a refusal never reveals that another party's booking exists — the
  // same anti-enumeration rule `lockClientOwnedBookingSchedule` and B3's hold
  // path follow.
  const owner = args.reschedule.owner
  const ownedByViewer = booking
    ? owner.kind === 'CLIENT'
      ? booking.clientId === owner.clientId
      : booking.professionalId === owner.professionalId
    : false

  if (!booking || !ownedByViewer) {
    return { ok: false, code: 'BOOKING_NOT_FOUND' }
  }

  if (
    booking.professionalId !== args.professionalId ||
    booking.offeringId !== args.offeringId
  ) {
    return { ok: false, code: 'RESCHEDULE_BOOKING_MISMATCH' }
  }

  try {
    // The viewer's own role decides whether the cancellation-window cutoff
    // applies: a client inside it may not move the booking, a pro looking at the
    // same booking still may. Passing `owner.kind` keeps the grid honest for both
    // instead of showing one of them slots the commit would refuse.
    const { totalDurationMinutes } = resolveRescheduleCommitDurationMinutes(
      booking,
      { now: new Date(), actor: owner.kind },
    )

    return { ok: true, durationMinutes: totalDurationMinutes }
  } catch (error: unknown) {
    // The commit's own guards (cancelled/completed, already started, corrupt
    // duration, and a client past the cancellation-window cutoff) surface here as
    // the refusal the reschedule itself would give, rather than as a 500 — the
    // client learns the booking is unmovable while looking at the grid instead of
    // after picking a time.
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

/**
 * Width for an AFTERCARE REBOOK of `rebookOf.bookingId`.
 *
 * The rebook commit (`performLockedCreateRebookedBooking`) clones the SOURCE
 * booking's service items — base plus add-ons at their snapshot durations — so
 * a same-mode offer must be sized by `computeRebookCloneDurationMinutes`, the
 * function the commit itself runs. Sizing from the offering alone advertised
 * starts the clone doesn't fit whenever the original had add-ons.
 *
 * A MODE-SWITCHED rebook (salon original offered as mobile, or vice versa) is
 * the commit's `isLocationOverride` branch: it re-derives duration from the
 * live offering for the requested mode and only allows single-item bookings.
 * Mirror both halves — multi-item switches get the commit's own refusal, and
 * single-item switches fall through to the offering-based sizing the caller
 * already resolved for the requested mode.
 */
async function resolveRebookOfDurationMinutes(
  args: ResolveAvailabilityDurationArgs,
  rebookOf: RescheduleAvailabilityContext,
): Promise<ResolveAvailabilityDurationResult> {
  // The clone carries the source's add-ons already — a separate add-on
  // selection has nothing to attach to. Same refusal the reschedule path gives.
  if (args.addOnIds.length > 0) {
    return {
      ok: false,
      code: 'ADDONS_INVALID',
      userMessage:
        'Add-ons can’t be changed when booking the next appointment. They come from the original booking.',
    }
  }

  const client = args.client ?? prisma

  const source: RebookSourceWidthRow | null = await client.booking.findUnique({
    where: { id: rebookOf.bookingId },
    select: REBOOK_SOURCE_WIDTH_SELECT,
  })

  // A missing booking and someone else's booking answer identically — the
  // same anti-enumeration rule the reschedule context follows.
  const owner = rebookOf.owner
  const ownedByViewer = source
    ? owner.kind === 'CLIENT'
      ? source.clientId === owner.clientId
      : source.professionalId === owner.professionalId
    : false

  if (!source || !ownedByViewer || source.professionalId !== args.professionalId) {
    return { ok: false, code: 'BOOKING_NOT_FOUND' }
  }

  if (source.locationType !== args.locationType) {
    if (source.serviceItems.length > 1) {
      // The commit refuses to switch in-person/mobile on a multi-item rebook
      // ("no add-ons to re-price") — so the offer must not count for it either.
      return {
        ok: false,
        code: 'INVALID_SERVICE_ITEMS',
        userMessage:
          'Switching in-person/mobile isn’t available for this booking.',
      }
    }

    // Single-item mode switch: the commit re-derives from the live offering
    // for the requested mode — exactly the base sizing the plain path does.
    const result = await resolveDurationWithAddOns({
      professionalId: args.professionalId,
      offeringId: args.offeringId,
      addOnIds: [],
      locationType: args.locationType,
      baseDurationMinutes: args.baseDurationMinutes,
      client: args.client,
    })

    return result.ok
      ? { ok: true, durationMinutes: result.durationMinutes }
      : { ok: false, code: result.code }
  }

  return {
    ok: true,
    durationMinutes: computeRebookCloneDurationMinutes(source),
  }
}
