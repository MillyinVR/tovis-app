// lib/payments/tipSuggestions.ts
//
// The ONE reading of a pro's saved tip suggestions.
//
// 🔴 There used to be two. `lib/payments/clientPaymentOptions.ts` (which feeds
// the native checkout) understood the shape the pro editor actually saves —
// `[{ label, percent }]` — while `ClientCheckoutCard` carried its own copy that
// only understood bare numbers and strings. So a pro who set 18 / 22 / 25 got
// exactly that on iOS and the platform's 15 / 20 / 25 on web: their setting was
// silently ignored on the surface most clients use.
//
// This module has NO Prisma import on purpose — a client component can import
// it without pulling the Prisma runtime into the browser bundle, which is the
// reason the duplicate existed in the first place.

/** What the client is offered when the pro has expressed no preference. */
export const DEFAULT_TIP_PERCENTS: readonly number[] = [15, 20, 25]

/**
 * Percentages out of whatever the column holds.
 *
 * Accepts every shape that has ever been written to it: a bare number, a
 * numeric string, or the `{ label, percent }` row the pro editor saves today.
 * Anything else is dropped rather than guessed at. Out-of-range values are
 * dropped too — a "150% tip" chip is a data bug, not an offer.
 */
export function normalizeTipSuggestionPercents(value: unknown): number[] {
  if (!Array.isArray(value)) return []

  const percents: number[] = []

  for (const item of value) {
    let raw: number

    if (typeof item === 'number') {
      raw = item
    } else if (typeof item === 'string') {
      raw = Number(item.trim())
    } else if (
      typeof item === 'object' &&
      item !== null &&
      'percent' in item &&
      typeof (item as { percent: unknown }).percent === 'number'
    ) {
      raw = (item as { percent: number }).percent
    } else {
      continue
    }

    if (!Number.isFinite(raw)) continue

    const percent = Math.trunc(raw)
    if (percent < 0 || percent > 100) continue
    if (percents.includes(percent)) continue

    percents.push(percent)
  }

  return percents
}

/**
 * The chips to draw, given the prop the booking page passes down.
 *
 * That prop is deliberately three-valued, and each value means something
 * different:
 *   · an ARRAY  — the pro's own suggestions (possibly empty: "no chips").
 *   · `false`   — suppressed outright.
 *   · `true` / null / undefined — nobody has configured anything, so fall back
 *     to the platform defaults rather than showing a client no way to tip.
 *
 * ⚠️ An empty ARRAY is NOT the same as absent. A pro who deleted every
 * suggestion chose to have none, and quietly restoring 15/20/25 would put back
 * exactly what they removed.
 */
export function resolveTipPresetPercents(value: unknown): number[] {
  if (value === false) return []
  if (Array.isArray(value)) return normalizeTipSuggestionPercents(value)
  return [...DEFAULT_TIP_PERCENTS]
}
