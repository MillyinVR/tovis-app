// lib/booking/discoveryProvenance.ts
//
// Resolves the SERVER-VALIDATED provenance of a booking — how the client actually
// found this pro — from facts the server can verify, NOT from a client-supplied
// flag. This is a trust boundary: LOOKS_FEED / DISCOVERY_SEARCH gate the one-time
// platform fee (see lib/booking/discoveryFee.ts), so the inputs here must all be
// derived from server state (DB lookups, validated tokens), never echoed request
// fields.
//
// This module is PURE and unit-testable. The finalize route loads the signals
// below and calls resolveDiscoveryProvenance to stamp Booking.discoveryProvenance.
//
// Signal sourcing (done by the caller, all server-side):
//   - proCreated:        the booking is being created by the pro, not the client.
//   - aftercare:         a valid aftercare rebook token was presented.
//   - arrivedViaProNfc:  an AttributionEvent ties this client to THIS pro's NFC card.
//   - validLookPost:     lookPostId/mediaId resolves to a LookPost owned by THIS pro.
//   - discoveryViewKind: the most-recent server-recorded discovery-view attribution
//                        for (client, pro) — 'LOOKS_FEED' | 'DISCOVERY_SEARCH' — or
//                        null. Recorded when the client opens the pro from the feed
//                        / Discovery tab, so it cannot be forged by the booking call.
//
// Precedence is most-specific-and-trusted first. When nothing positively proves a
// discovery origin we fall back to DIRECT_PROFILE (no fee) — we never *assume*
// discovery, so we never over-charge.

import { BookingDiscoveryProvenance } from '@prisma/client'

export type DiscoveryProvenanceSignals = Readonly<{
  proCreated: boolean
  aftercare: boolean
  arrivedViaProNfc: boolean
  /** lookPostId/mediaId was validated server-side to belong to this pro. */
  validLookPost: boolean
  /** Server-recorded discovery-view attribution kind for (client, pro), if any. */
  discoveryViewKind: 'LOOKS_FEED' | 'DISCOVERY_SEARCH' | null
}>

export function resolveDiscoveryProvenance(
  signals: DiscoveryProvenanceSignals,
): BookingDiscoveryProvenance {
  if (signals.proCreated) return BookingDiscoveryProvenance.PRO_CREATED
  if (signals.aftercare) return BookingDiscoveryProvenance.AFTERCARE
  if (signals.arrivedViaProNfc) return BookingDiscoveryProvenance.NFC

  // Validated Looks-feed reference is the strongest discovery proof.
  if (signals.validLookPost) return BookingDiscoveryProvenance.LOOKS_FEED

  // Otherwise honor a server-recorded discovery-view attribution.
  if (signals.discoveryViewKind === 'LOOKS_FEED') {
    return BookingDiscoveryProvenance.LOOKS_FEED
  }
  if (signals.discoveryViewKind === 'DISCOVERY_SEARCH') {
    return BookingDiscoveryProvenance.DISCOVERY_SEARCH
  }

  // No positive proof of a discovery origin: treat as direct (no platform fee).
  return BookingDiscoveryProvenance.DIRECT_PROFILE
}
