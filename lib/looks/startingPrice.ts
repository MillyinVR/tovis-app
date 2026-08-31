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
  const amount = moneyToNumber(price)
  if (amount === null || amount <= 0) return null

  const dollars = formatRoundedDollars(amount)
  if (!dollars) return null

  return `${COPY.bookingConfirmation.priceFrom} ${dollars}`
}
