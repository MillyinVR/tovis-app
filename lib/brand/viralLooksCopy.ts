// lib/brand/viralLooksCopy.ts
//
// What a viral look's pro count SAYS, in one place.
//
// ── Why this module exists ─────────────────────────────────────────────────
//
// The count has had one definition since slice 3 — `OFFERING_PRO_OFFER_WHERE`
// in lib/viralRequests/liveLooks.ts, composed by every count and every list so
// the number and the names cannot drift. The SENTENCE around that number did
// not: five surfaces spelled it out by hand (the client home's hero and strip,
// the look page's lede, that page's list heading, and the pro library), so an
// edit to one of them was an edit to one of them.
//
// Two rules, both learned from a shipped defect:
//
//  1. **Every branch is a whole sentence.** Interpolating a pluralised noun
//     into a fixed verb — `${n} ${n === 1 ? 'pro' : 'pros'} now offer this` —
//     is what rendered "1 pro now offer this". One pro is the ORDINARY case now
//     that the number counts opt-ins rather than notifications: it is what every
//     look reads the moment its first pro says yes.
//
//  2. **The sentence names the scope.** Tori, 2026-09-15: keep the count
//     platform-wide, but say so. A bare "3 pros now offer this" reads as "3
//     pros near me", and there is no geography in the query at all —
//     `findMatchingProsByRequestedCategory` filters on the requested category
//     and on public pro visibility, and on nothing else. Naming the brand is
//     what makes the scope explicit without promising a radius the product does
//     not have. Nearby filtering and ranking remain undecided and unbuilt.
//
// `brandName` is the brand's DISPLAY name (`BrandConfig.displayName`), not the
// lowercase wordmark — it lands mid-sentence in prose. Resolve it from the
// tenant brand (`getBrandForTenantContext(...).displayName`), never as a
// literal: `check:no-hardcoded-brand-strings` fails a hardcoded brand string in
// user-facing copy, and a white-label tenant must not be told how many pros
// another brand has.
//
// The native side carries the same sentences on `HomeViral`, in tovis-ios
// TovisKit/Sources/TovisKit/Models/ClientHome.swift. Change one, change both —
// they are the same claim, to the same client, on two screens.

/**
 * The count as a card line: "3 pros on TOVIS offer this".
 *
 * Zero is a statement in its own right rather than "0 pros", and it is the
 * state every newly approved look starts in.
 */
export function viralOfferingProsLine(count: number, brandName: string): string {
  if (count <= 0) return `No pro on ${brandName} offers this yet`
  if (count === 1) return `1 pro on ${brandName} offers this`
  return `${count} pros on ${brandName} offer this`
}

/**
 * The look page's lede — the single sentence the whole opt-in slice exists to
 * make true, now with its scope named.
 *
 * Full sentences with terminal punctuation, unlike the card line above.
 */
export function viralOfferingLede(count: number, brandName: string): string {
  if (count <= 0) return 'No pro has taken this one on yet.'
  if (count === 1) return `1 pro on ${brandName} has said they can do this look.`
  return `${count} pros on ${brandName} have said they can do this look.`
}

/**
 * The bare subject phrase, for a heading beside a list rather than a sentence:
 * "3 pros on TOVIS". No verb, so nothing here can disagree with one.
 */
export function viralOfferingProCountLabel(
  count: number,
  brandName: string,
): string {
  if (count === 1) return `1 pro on ${brandName}`
  return `${count} pros on ${brandName}`
}
