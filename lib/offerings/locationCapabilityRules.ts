// lib/offerings/locationCapabilityRules.ts
//
// The CLIENT-SAFE half of W6 location capability: the shape, and the two pure
// rules that read it. No Prisma — the pro-facing Add-service form (a client
// component) needs `defaultOfferingModes` to seed its toggles, and importing it
// from the query module shipped `new PrismaClient()` into that page's bundle.
//
// The query that PRODUCES a `ProLocationCapability`, and the location-type
// constants it filters on (which are Prisma enum values), stay in the
// server-only sibling `@/lib/offerings/locationCapability` — which re-exports
// everything here, so server call sites keep one import.

export type ProLocationCapability = {
  /** The pro has at least one bookable SALON/SUITE location. */
  salon: boolean
  /** The pro has at least one bookable MOBILE_BASE location. */
  mobile: boolean
}

/**
 * Narrow an offering's advertised modes to what the pro can actually host.
 *
 * ⚠️ Read boundary — belt and braces. Prod already contains offerings whose
 * `offersInSalon` was never a choice, so the flag alone cannot be trusted even
 * after the default changes and the backfill runs. Apply this everywhere an
 * offering's modes are published to a CLIENT; the pro's own management surfaces
 * keep showing the raw flags so they can see and fix what they have.
 */
export function narrowOfferingModes<T extends { offersInSalon: boolean; offersMobile: boolean }>(
  offering: T,
  capability: ProLocationCapability,
): T {
  return {
    ...offering,
    offersInSalon: offering.offersInSalon && capability.salon,
    offersMobile: offering.offersMobile && capability.mobile,
  }
}

/**
 * The modes to pre-select for an offering whose creator has not stated them.
 *
 * ONE rule, three consumers: `POST /api/v1/pro/offerings` applies it server-side
 * when a flag is omitted, the web Add-service form seeds its toggles with it,
 * and `GET /api/v1/pro/services/catalog` ships it to the iOS form so that form
 * does not have to re-derive it in Swift. Before it was extracted, the web form
 * and the POST route each spelled the same expression out, and iOS did neither —
 * it hardcoded salon-on/mobile-off, which is how a mobile-only pro creating a
 * service on the phone still wrote `offersInSalon: true`.
 *
 * A pro with NEITHER capability yet (no bookable location at all) gets salon,
 * because a form refuses to submit with both modes off and the read boundary
 * (`narrowOfferingModes`) takes an unhostable mode back off before any client
 * sees it.
 */
export function defaultOfferingModes(capability: ProLocationCapability): {
  offersInSalon: boolean
  offersMobile: boolean
} {
  return {
    offersInSalon: capability.salon || !capability.mobile,
    offersMobile: !capability.salon && capability.mobile,
  }
}
