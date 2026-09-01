// lib/looks/startingPrice.ts

import { COPY } from '@/lib/copy'
import { formatRoundedDollars, moneyToNumber, type MoneyInput } from '@/lib/money'

/**
 * A look's client-facing price label — "From $250".
 *
 * ⚠️ Single source of truth for this label. Three surfaces composed it by hand
 * (the feed overlay, the bookable looks grid, the `/u/[handle]` loader) and had
 * already drifted: the overlay hardcoded the word "From", skipped the brand copy
 * table, and rounded differently, so the same look read "From $249.5" in the
 * feed and "From $250" everywhere else.
 *
 * Two rules this encodes, both standing:
 * - A look's price is a STARTING price — a consultation can revise the total —
 *   so it is never rendered as a bare figure (Tori's standing rule).
 * - The word comes from the brand copy table, so a white-label deployment
 *   retitles it in one place.
 *
 * Returns null when there is no price to show, which every caller renders as
 * "no price pill" rather than an empty or zero-dollar label. A non-positive
 * price is treated as no price: "From $0" is a promise the pro never made.
 *
 * With service names gone from the client-facing feed (Book the Look, B1) this
 * is the only number a look carries, so the three surfaces must agree.
 */
export function formatLookStartingPrice(
  price: MoneyInput | null | undefined,
): string | null {
  return composeStartingPrice(price, COPY.bookingConfirmation.priceFrom)
}

/**
 * A consult booking proposal's client-facing price — "Starting at $340"
 * (Book the Look, B4; docs/product/BOOK-THE-LOOK-DIRECTION.md, decision 5).
 *
 * Lives HERE, beside the look label, rather than in lib/consult: this module is
 * the home of the standing rule that a client-facing price is a STARTING price
 * composed from the brand copy table and never a bare figure. A second module
 * spelling that out again is how the look label drifted three ways before B1
 * consolidated it — so the two labels share one composer and differ only in
 * their word.
 *
 * The word IS different on purpose. "From $250" is what a look's card promises
 * anyone scrolling; this number was derived from THIS client's photos against
 * THIS pro's menu, so a white-label deployment must be able to retitle them
 * apart.
 *
 * ⚠️ Never render this without the estimate framing beside it
 * (`COPY.consultProposal.estimateNote` + `proDecides`). Decision 5 makes
 * "the pro makes the final call" part of the price, not a footnote to it.
 *
 * Returns null on a non-positive total, exactly as the look label does — the
 * caller renders no price rather than "Starting at $0".
 */
export function formatConsultProposalStartingPrice(
  price: MoneyInput | null | undefined,
): string | null {
  return composeStartingPrice(price, COPY.consultProposal.startingAt)
}

function composeStartingPrice(
  price: MoneyInput | null | undefined,
  word: string,
): string | null {
  const amount = moneyToNumber(price)
  if (amount === null || amount <= 0) return null

  const dollars = formatRoundedDollars(amount)
  if (!dollars) return null

  return `${word} ${dollars}`
}
