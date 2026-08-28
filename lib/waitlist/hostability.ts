// lib/waitlist/hostability.ts
//
// One answer to "can this pro actually fulfil a waitlist request for this
// service, and in which mode?" — shared by the client's availability bootstrap,
// the client's join, and the pro's offer.
//
// Before this module the three disagreed. Bootstrap hardcoded
// `waitlistSupported: true`, so a mobile-only pro's booking drawer rendered a
// salon waitlist panel; join wrote a `WaitlistEntry` without checking anything,
// so the row was created for a combination nobody could ever host; and the offer
// route refused with a bare `locationType !== SALON` string compare that named
// no reason the pro could act on. A client could therefore join a queue the pro
// was structurally unable to serve, and never be told.
//
// The capability itself is NOT re-derived here. `loadProLocationCapability` /
// `narrowOfferingModes` (lib/offerings/locationCapability.ts) already own the
// "which modes does this pro have a bookable location for" question, and the
// availability read path already narrows an offering through them. This module
// adds only the waitlist-specific layer on top: of the modes a pro can host,
// which ones a waitlist offer can currently be FULFILLED in.
//
// ⚠️ That distinction is still real even though, today, the two answers
// coincide: every mode a pro can host is also one an offer can be fulfilled in.
// See WAITLIST_FULFILLABLE_MODES for what "fulfillable" costs.

import { ServiceLocationType } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  loadProLocationCapability,
  narrowOfferingModes,
} from '@/lib/offerings/locationCapability'

type DbClient = Parameters<typeof loadProLocationCapability>[1]

/** An offering's advertised modes, already narrowed to what the pro can host. */
export type HostableOfferingModes = {
  offersInSalon: boolean
  offersMobile: boolean
}

/**
 * The modes a waitlist offer can be carried all the way to a booking in.
 *
 * MOBILE was excluded until 2026-08-27, and the exclusion was correct while it
 * lasted: `confirmClientWaitlistOffer` booked with a hardcoded
 * `clientAddressId: null`, `assertMobileBookingWithinRadius` throws
 * `CLIENT_SERVICE_ADDRESS_REQUIRED` for a MOBILE booking without one, and
 * `WaitlistOffer` had no column to carry one — so a mobile offer could be made
 * and then be impossible for the client to accept, a promise aimed at the one
 * person who cannot act on it.
 *
 * It was widened only once all three landed together: `WaitlistOffer.clientAddressId`
 * (+ the pro-facing distance/area snapshot), the radius check running at OFFER
 * time inside `createWaitlistOffer`, and the confirm passing the stored address
 * through. Those three are what "fulfillable" means here.
 *
 * ⚠️ The same rule binds the next entry. A mode belongs on this list only when
 * the client's confirm can complete it unaided — not when the offer can merely
 * be written.
 */
export const WAITLIST_FULFILLABLE_MODES: readonly ServiceLocationType[] = [
  ServiceLocationType.SALON,
  ServiceLocationType.MOBILE,
]

function isFulfillable(mode: ServiceLocationType): boolean {
  return WAITLIST_FULFILLABLE_MODES.includes(mode)
}

/**
 * Which modes this pro could actually be given a waitlist offer in, from an
 * offering whose flags are ALREADY narrowed to the pro's bookable locations.
 *
 * Pure, so the availability bootstrap — which has narrowed flags in hand from
 * `loadAvailabilityOfferingContext` and must not pay for another round trip on a
 * cached hot path — reaches the same verdict as the two write paths below
 * without a second query or a second copy of the rule.
 */
export function waitlistHostableModes(
  modes: HostableOfferingModes,
): ServiceLocationType[] {
  const hostable: ServiceLocationType[] = []

  if (modes.offersInSalon && isFulfillable(ServiceLocationType.SALON)) {
    hostable.push(ServiceLocationType.SALON)
  }
  if (modes.offersMobile && isFulfillable(ServiceLocationType.MOBILE)) {
    hostable.push(ServiceLocationType.MOBILE)
  }

  return hostable
}

/**
 * Whether a waitlist is worth showing / joining at all for this offering.
 *
 * This is what `waitlistSupported` on the availability bootstrap means: not "the
 * product has a waitlist feature" (it always does) but "if you join this queue,
 * this pro can actually offer you a time".
 */
export function isWaitlistSupportedForModes(
  modes: HostableOfferingModes,
): boolean {
  return waitlistHostableModes(modes).length > 0
}

export type WaitlistHostabilityRefusal =
  /** No active offering for this pro + service at all. */
  | { kind: 'NO_ACTIVE_OFFERING' }
  /**
   * The offering exists, but every mode it advertises is one the pro cannot host
   * (no bookable location) or one a waitlist offer cannot be fulfilled in.
   *
   * This used to carry `advertisesMobileOnly`, to separate "this pro travels to
   * you, and travel waitlists aren't a thing yet" from "this pro cannot host
   * this service anywhere". Widening WAITLIST_FULFILLABLE_MODES to include
   * MOBILE closed the first case: a narrowed `offersMobile` now yields a
   * hostable mode, so a refusal can no longer be reached with it set. The flag
   * was removed rather than left permanently false — a discriminant that cannot
   * fire still gets branched on, and its copy ("only in-salon right now") is now
   * simply untrue.
   */
  | { kind: 'NO_HOSTABLE_MODE' }

export type WaitlistHostability =
  | { ok: true; offeringId: string; modes: ServiceLocationType[] }
  | { ok: false; refusal: WaitlistHostabilityRefusal }

/**
 * Resolve waitlist hostability for a pro + service straight from the database.
 *
 * `isActive: true` deliberately matches `createWaitlistOffer`'s own offering
 * lookup, so the join cannot admit a combination the offer would later refuse.
 */
export async function loadWaitlistHostability(args: {
  professionalId: string
  serviceId: string
  client?: DbClient
}): Promise<WaitlistHostability> {
  const client = args.client ?? prisma

  const offering = await client.professionalServiceOffering.findFirst({
    where: {
      professionalId: args.professionalId,
      serviceId: args.serviceId,
      isActive: true,
    },
    select: { id: true, offersInSalon: true, offersMobile: true },
  })

  if (!offering) {
    return { ok: false, refusal: { kind: 'NO_ACTIVE_OFFERING' } }
  }

  // The same narrowing the client-facing read path applies, for the same reason:
  // prod holds offerings whose `offersInSalon` was never a choice (the column
  // used to default to `true`), so the flag alone cannot be trusted.
  const capability = await loadProLocationCapability(
    args.professionalId,
    client,
  )
  const narrowed = narrowOfferingModes(
    {
      offersInSalon: offering.offersInSalon,
      offersMobile: offering.offersMobile,
    },
    capability,
  )

  const modes = waitlistHostableModes(narrowed)

  if (modes.length === 0) {
    // Reachable only when NEITHER mode survived narrowing — the pro advertises
    // this service but has no bookable location to host it in, in any mode.
    return { ok: false, refusal: { kind: 'NO_HOSTABLE_MODE' } }
  }

  return { ok: true, offeringId: offering.id, modes }
}

/**
 * Client-facing sentence for a refusal. One wording, so the join endpoint and
 * anything that later refuses for the same reason cannot drift apart.
 */
export function waitlistRefusalMessage(
  refusal: WaitlistHostabilityRefusal,
): string {
  if (refusal.kind === 'NO_ACTIVE_OFFERING') {
    return 'This pro is not currently offering this service, so there is no waitlist to join.'
  }

  return 'This pro cannot take appointments for this service right now, so there is no waitlist to join.'
}
