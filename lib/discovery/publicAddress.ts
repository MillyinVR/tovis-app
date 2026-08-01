// lib/discovery/publicAddress.ts
//
// W7: THE rule for whether an unauthenticated audience gets a pro's exact
// address, and the redaction applied when they don't.
//
// `/api/v1/search/pros` and `/api/v1/pros/nearby` are both unauthenticated and
// both had their own copy of the redaction. They now share this one, so the two
// cannot drift — a discovery surface that redacts one way and publishes another
// is how an address leak survives review.
//
// Reported symptom this exists for: Discover's Navigate button "was navigating
// to a random address". No address was leaking — the redaction was working. The
// bug was that a DIRECTIONS button was built on top of coordinates deliberately
// coarsened to a ~1.1km grid, so Maps received a fuzzed point with no address
// and snapped to whatever building was nearest. For a mobile-only pro the only
// location with coordinates is their MOBILE_BASE, so it pointed at a fuzzed
// version of their home.

import { ProfessionalLocationType } from '@prisma/client'

import { coarsenPublicCoordinate } from '@/lib/discovery/publicCoordinates'

type PublishableLocation = {
  formattedAddress: string | null
  isAddressPublic: boolean
  locationType: ProfessionalLocationType | null
}

/**
 * Whether this location's exact address may be published publicly.
 *
 * Every condition must hold:
 *  - the pro explicitly published it (`isAddressPublic`),
 *  - there IS an address to publish, and
 *  - it is somewhere clients go. A MOBILE_BASE is where the pro STARTS FROM —
 *    usually their home. It is never a destination, so it is never publishable
 *    however the flag is set. This is the belt to the toggle's braces: the
 *    control that sets `isAddressPublic` is only offered on salon-type
 *    locations, and this refuses a MOBILE_BASE that got the flag anyway.
 */
export function isLocationAddressPublishable(
  location: PublishableLocation,
): boolean {
  if (!location.isAddressPublic) return false
  if (location.formattedAddress == null) return false
  if (location.locationType === ProfessionalLocationType.MOBILE_BASE) return false
  if (location.locationType == null) return false

  return true
}

/**
 * Apply the public-audience view of a location: exact address and true
 * coordinates when the pro published them, today's redaction otherwise
 * (address + placeId nulled, coordinates coarsened to a neighborhood grid).
 *
 * ⚠️ Apply at the public route boundary only — never inside the loaders, whose
 * exact output also feeds the search index and the authenticated surfaces.
 *
 * `distanceMiles` is computed in SQL from exact coordinates BEFORE this runs, so
 * "how far away" stays accurate either way.
 */
export function toPublicAddressView<
  T extends PublishableLocation & {
    placeId: string | null
    lat: number | null
    lng: number | null
  },
>(location: T): T {
  if (isLocationAddressPublishable(location)) return location

  return {
    ...location,
    formattedAddress: null,
    placeId: null,
    lat: coarsenPublicCoordinate(location.lat),
    lng: coarsenPublicCoordinate(location.lng),
  }
}
