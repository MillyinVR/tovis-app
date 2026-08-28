// lib/waitlist/offerArea.ts
//
// The general-area label a pro is shown for a PENDING mobile waitlist offer —
// "roughly where am I being asked to travel?" — and nothing sharper.
//
// The product rule (Tori, 2026-08-27): at OFFER time, before the client has
// accepted, the pro sees a rough distance and a general area. The exact address
// arrives only once the client has ACCEPTED that specific offer, through the
// channels a normal MOBILE booking's address already uses. This is the same
// consent-gating the rest of the app applies to service addresses — a waitlist
// client is CONTACT_ONLY (`getProClientVisibility`: joining a waitlist
// auto-creates a message thread and nothing else), so their chart, service
// addresses included, is closed to the pro until a booking exists.
//
// 🔴 The street line is not merely omitted here, it is unreachable: this module
// is not given one. `buildDiscoveryLocationLabel` — the app's existing
// "City, ST" rule, reused so a place reads the same everywhere — falls back to
// `formattedAddress` when city and state are both absent, which for a client
// address IS the front door. It is called below with `formattedAddress: null`
// so that fallback can never fire, and the postal prefix takes that slot
// instead.

import { buildDiscoveryLocationLabel } from '@/lib/discovery/nearby'

/**
 * The only fields of a client's saved address this label may be built from.
 *
 * Deliberately narrow, and deliberately NOT `formattedAddress` / `addressLine1`
 * / `lat` / `lng`. `postalCodePrefix` is the coarsened surrogate the address
 * privacy scheme already writes (lib/security/addressEncryption.ts) — it is
 * indexed and treated as non-PII there for exactly this kind of use.
 */
export type WaitlistOfferAreaInput = {
  city: string | null
  state: string | null
  postalCodePrefix: string | null
}

/**
 * "San Diego, CA" — or the postal prefix when the address has no city/state,
 * or null when it has neither.
 *
 * null is a real answer, not a failure: the pro-facing card then says only how
 * far away the trip is. Falling back to anything more specific is the one thing
 * this must never do.
 */
export function buildWaitlistOfferAreaLabel(
  address: WaitlistOfferAreaInput,
): string | null {
  const cityState = buildDiscoveryLocationLabel({
    location: {
      city: address.city,
      state: address.state,
      // 🔴 Load-bearing. See the header: this is what stops the shared label
      // helper from falling back to the client's street address.
      formattedAddress: null,
    },
  })

  if (cityState) return cityState

  const postalCodePrefix = address.postalCodePrefix?.trim() ?? ''
  return postalCodePrefix.length > 0 ? postalCodePrefix : null
}

/**
 * The one sentence a pro reads about a pending mobile offer: how far, and
 * roughly where.
 *
 * Composed on the SERVER and rendered verbatim by both clients — the same rule
 * `formatWaitlistPreferenceLabel` follows, and for the same reason: this is the
 * wording of a privacy boundary, and a boundary whose phrasing is re-authored
 * per platform drifts per platform. iOS carries no copy of this rule.
 *
 * Either half may be missing and the sentence still reads: a legacy offer has no
 * distance, an address with no city/state/postal code has no area. null means
 * neither is known, and the card says nothing about the trip rather than
 * something empty.
 */
export function formatWaitlistOfferTravelSummary(args: {
  distanceMiles: number | null
  areaLabel: string | null
}): string | null {
  const parts: string[] = []

  if (
    typeof args.distanceMiles === 'number' &&
    Number.isFinite(args.distanceMiles)
  ) {
    // One decimal, matching how every other distance in the app is written
    // (Discover's pro rows, the alternates list). Deliberately coarse: this is
    // "roughly how far", not a measurement anyone should navigate by.
    parts.push(`${args.distanceMiles.toFixed(1)} mi away`)
  }

  const areaLabel = args.areaLabel?.trim() ?? ''
  if (areaLabel) parts.push(areaLabel)

  return parts.length > 0 ? parts.join(' · ') : null
}
