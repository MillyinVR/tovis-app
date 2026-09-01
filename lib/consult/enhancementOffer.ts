// lib/consult/enhancementOffer.ts
//
// Book the Look, slice B7 — how an ENHANCEMENT is put to a person
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decision 10).
//
// Decision 10 gives the exact shape of the offer: "a gloss keeps this tone from
// going brassy — +$40, +20 min". Two of those three parts are numbers, and both
// are composed HERE, on the server, for the same reason every other consult
// figure is: a label assembled in a component is a second answer about money.
//
// A DELTA, not a price. The client is not choosing between totals, she is
// deciding whether one extra thing is worth its cost and its time — so the sign
// is part of the label and a bare "$40" is never returned.
//
// Both return null rather than a zero label:
//   • a complimentary service is a real thing a pro lists, it adds nothing to
//     the money and it still takes time out of her day
//     (lib/consult/serviceEstimate.ts says so where it lets a zero price
//     through), so "+$0" must simply not render; and
//   • an instant enhancement adds no minutes, and "+0 min" is noise.
// A card with one half missing still reads correctly; a card claiming "+$0"
// looks like a bug.

import { formatDurationLabel } from '@/lib/format/duration'
import {
  formatRoundedDollars,
  moneyToNumber,
  type MoneyInput,
} from '@/lib/money'

/**
 * The most enhancement ids any caller will read off the wire.
 *
 * A ceiling, not a business rule: an estimate's beyond-floor lines come from
 * one analysis's recommendations and are counted in single digits, so a longer
 * list is a script rather than a person. Truncating is safe in the one
 * direction that matters — an id that does not reach the derivation simply is
 * not on the booking, and the floor is never affected.
 */
export const MAX_CONSULT_ENHANCEMENT_LINE_IDS = 20

export function formatEnhancementPriceDelta(
  price: MoneyInput | null | undefined,
): string | null {
  // Tested on the AMOUNT, not on the rendered string: `formatRoundedDollars`
  // rounds, so a would-be "$0" can also come from a real-but-tiny price, and
  // matching the label would be matching the wrong thing.
  const amount = moneyToNumber(price)
  if (amount === null || amount <= 0) return null

  const dollars = formatRoundedDollars(amount)
  return dollars ? `+${dollars}` : null
}

export function formatEnhancementDurationDelta(
  minutes: number | null | undefined,
): string | null {
  const label = formatDurationLabel(minutes)
  return label ? `+${label}` : null
}
