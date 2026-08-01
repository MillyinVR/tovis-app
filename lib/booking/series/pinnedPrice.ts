// lib/booking/series/pinnedPrice.ts
//
// K20 (Phase 8) — what a LATER occurrence of a standing appointment costs.
//
// This is the decision K19 deliberately left open. K19 pins the price the pro
// SEES to occurrence 0's `subtotalSnapshot` and surfaces drift; it never applies
// it, because K18 materializes every occurrence in a single pass at a single
// moment, so there is nothing to apply. K20's roll-forward cron is the first
// thing in the system that can materialize an occurrence WEEKS after the pro
// agreed the price — and `performLockedCreateProBooking` re-resolves the
// offering's price on every call. Left alone, the cron would raise a standing
// client's price the first time the pro edited their catalog, unattended, with
// nobody told.
//
// 🔴 THE DECISION: the PIN wins. A follow-on occurrence is booked at what
// occurrence 0 was booked at, line by line — the base service price and each
// add-on's price. Three reasons, in order of weight:
//
//  1. The plan names the alternative by name. "Silently repricing a standing
//     client" is the failure mode Phase 8 was written to avoid, and a cron is
//     the most silent writer in the app: no request, no actor, no screen.
//  2. `BookingSeries` already carries this principle in its own schema, written
//     by K18 FOR this step — the pro's override grants are STORED "so K20's
//     unattended cron cannot grant an override the pro never asked for". A price
//     rise the pro never asked to apply to this client is the same class of act.
//  3. Otherwise one series would hold occurrences 0…11 at the old price and
//     12…23 at the new one — which is exactly the `occurrencesDisagree`
//     condition K19 built to flag as an ANOMALY. A rule that routinely produces
//     its own alarm is not a rule.
//
// The cost of the pin is real and is NOT hidden: a standing client can stay
// below the pro's list price indefinitely. That is why the series page states
// the rule in words and prints the moved list price beside the pinned one
// (K19's `listPriceMoved`), and why the pro's remedy — end the series and start
// a new one at today's price — is one button on that same page. A grandfathered
// price the pro can SEE and end is a business decision; one applied by a cron at
// 4am is not.
//
// 🔴 Derived, never passed in. The pin is read from occurrence 0's own
// `BookingServiceItem` rows inside the caller's transaction, keyed off the
// `seriesId` the write boundary already holds — the same reasoning that makes
// `SERIES_MATERIALIZATION` a derived overlap source rather than a request field
// ([[refuse-the-claim-not-just-the-control]]). No caller can inject a price into
// a booking by claiming one.
//
// DURATION is deliberately NOT pinned. Money is a promise to the client;
// duration is a fact about the pro's calendar, and an occurrence scheduled for
// the wrong length double-books or wastes the slot it reserved. The reserved
// window and the persisted duration must both come from today's resolution.

import { BookingServiceItemType, Prisma } from '@prisma/client'

/** The `notes` stamp that ties an ADD_ON line item back to its OfferingAddOn. */
const ADDON_NOTE_PREFIX = 'ADDON:'

export type SeriesPinnedPrices = {
  /** Occurrence 0's charged base unit price. */
  baseUnitPrice: Prisma.Decimal
  /** Occurrence 0's add-on prices, by `OfferingAddOn` link id. */
  addOnPriceByLinkId: Map<string, Prisma.Decimal>
}

/**
 * Read the price occurrence 0 of `seriesId` was actually booked at.
 *
 * Returns null when there is no occurrence 0 to read — it was hard-deleted, or
 * (impossible today) the series never materialized one. The caller then falls
 * back to today's resolution, which is the only remaining option: an occurrence
 * with no price is not a booking. That fallback is a silent reprice, so it is
 * kept to the one case where the pin genuinely does not exist rather than being
 * used as a convenience.
 */
export async function loadSeriesPinnedPrices(args: {
  tx: Prisma.TransactionClient
  seriesId: string
}): Promise<SeriesPinnedPrices | null> {
  const items = await args.tx.bookingServiceItem.findMany({
    where: {
      booking: { seriesId: args.seriesId, seriesOccurrenceIndex: 0 },
    },
    select: {
      itemType: true,
      priceSnapshot: true,
      notes: true,
    },
    take: 100,
  })

  const base = items.find((item) => item.itemType === BookingServiceItemType.BASE)
  if (!base) return null

  const addOnPriceByLinkId = new Map<string, Prisma.Decimal>()
  for (const item of items) {
    if (item.itemType !== BookingServiceItemType.ADD_ON) continue
    const notes = item.notes ?? ''
    if (!notes.startsWith(ADDON_NOTE_PREFIX)) continue
    const linkId = notes.slice(ADDON_NOTE_PREFIX.length).trim()
    if (!linkId) continue
    addOnPriceByLinkId.set(linkId, item.priceSnapshot)
  }

  return { baseUnitPrice: base.priceSnapshot, addOnPriceByLinkId }
}
