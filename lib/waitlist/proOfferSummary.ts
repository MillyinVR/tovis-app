// lib/waitlist/proOfferSummary.ts
//
// THE pro-facing shape of a waitlist offer that has not been accepted yet — the
// Prisma select it is read with, and the DTO it becomes.
//
// Both halves live here, together, on purpose. The privacy rule this enforces is
// "while an offer is PENDING, the pro learns how far and roughly where, never
// the address" — and that rule is only as strong as the WEAKER of the two: a DTO
// that omits the street line is worthless if the row it was built from carried
// one, because the next person to add a field has the address sitting right
// there in scope. Reading through a select that never fetches it removes the
// temptation and the accident at once.
//
// Enforced server-side, not in the view: this is what `GET /api/v1/pro/waitlist`
// returns, so the API RESPONSE itself does not contain the address. Hiding it in
// `WaitlistOutreachClient` / `ProWaitlistView` would leave it one devtools panel
// away.
//
// The reveal is not built here, and deliberately so. Once the client accepts,
// `confirmClientWaitlistOffer` creates a real booking, that booking makes the pro
// chart-visible for the client (`getProClientVisibility`), and the address shows
// up through the same booking surfaces every other MOBILE appointment uses.
// There is no second address-reveal mechanism to get wrong.

import { Prisma, ServiceLocationType } from '@prisma/client'

import { decimalToNullableNumber } from '@/lib/booking/snapshots'
import { formatWaitlistOfferTravelSummary } from '@/lib/waitlist/offerArea'

/**
 * The ONLY columns a pro-facing read of a pending offer may fetch.
 *
 * 🔴 Do not add a ClientAddress field or relation to this. `tests/…` and
 * `lib/waitlist/proOfferSummary.test.ts` fail if you do — that failure is the
 * point, not an obstacle.
 */
export const PRO_WAITLIST_PENDING_OFFER_SELECT = {
  id: true,
  waitlistEntryId: true,
  startsAt: true,
  locationType: true,
  clientDistanceMiles: true,
  clientAreaLabel: true,
} satisfies Prisma.WaitlistOfferSelect

export type ProWaitlistPendingOfferRecord = Prisma.WaitlistOfferGetPayload<{
  select: typeof PRO_WAITLIST_PENDING_OFFER_SELECT
}>

/**
 * How far, and roughly where. Present only on a MOBILE offer.
 *
 * Both fields are nullable because both can legitimately be unknown: a legacy
 * MOBILE offer written before these columns existed has neither, and an address
 * with no city, state or postal code has no honest area to name. A card that
 * says only "3.2 mi away" is correct; one that invents a place is not.
 */
export type ProWaitlistOfferTravelSummary = {
  distanceMiles: number | null
  areaLabel: string | null
  /**
   * The rendered sentence — "3.2 mi away · San Diego, CA". Composed here so web
   * and iOS print the same words; neither client re-authors the phrasing of a
   * privacy boundary. null when neither half is known.
   */
  summary: string | null
}

export type ProWaitlistPendingOfferSummary = {
  id: string
  startsAt: string
  locationType: ServiceLocationType
  /** null for an in-salon offer — the client is coming to the pro. */
  travel: ProWaitlistOfferTravelSummary | null
}

/**
 * The pro-facing DTO for one pending offer.
 *
 * Takes the narrow record above rather than a `WaitlistOffer` so a caller cannot
 * hand it a fully-hydrated row and have the extra columns ride along on a future
 * edit — the argument type is part of the boundary.
 */
export function buildProWaitlistPendingOfferSummary(
  offer: ProWaitlistPendingOfferRecord,
): ProWaitlistPendingOfferSummary {
  return {
    id: offer.id,
    startsAt: offer.startsAt.toISOString(),
    locationType: offer.locationType,
    travel:
      offer.locationType === ServiceLocationType.MOBILE
        ? buildTravelSummary(offer)
        : null,
  }
}

function buildTravelSummary(
  offer: ProWaitlistPendingOfferRecord,
): ProWaitlistOfferTravelSummary {
  // The app's one Decimal→number bridge (lib/money.ts), which is already what
  // lat/lng columns go through. It does not round, so the miles here are exactly
  // what the radius gate measured and stored.
  const distanceMiles = decimalToNullableNumber(offer.clientDistanceMiles)
  const areaLabel = offer.clientAreaLabel

  return {
    distanceMiles,
    areaLabel,
    summary: formatWaitlistOfferTravelSummary({ distanceMiles, areaLabel }),
  }
}
