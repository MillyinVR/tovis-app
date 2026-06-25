// lib/discovery/publicCoordinates.ts
//
// Coordinate redaction for UNAUTHENTICATED discovery surfaces (nearby + search).
//
// Exact (rooftop-precision) coordinates reverse-geocode to a pro's address —
// which for mobile/home-based pros is their residence — and formattedAddress /
// placeId are the address outright. So any public payload must carry only
// coarse, neighborhood-level location. Distance is computed server-side from the
// exact coordinates BEFORE this redaction, so displayed distance stays accurate;
// only the map pin becomes approximate. Apply this at the public route boundary,
// never inside the loaders whose exact output also feeds the search index.

export const PUBLIC_COORD_DECIMALS = 2 // ~1.1 km grid

export function coarsenPublicCoordinate(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const factor = 10 ** PUBLIC_COORD_DECIMALS
  return Math.round(value * factor) / factor
}
