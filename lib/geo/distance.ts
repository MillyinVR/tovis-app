// lib/geo/distance.ts
//
// The one spherical "how far apart are these two points" in the app.
//
// It lived in three places before this file existed: `lib/discovery/nearby.ts`
// (exported, `asin` form), a PRIVATE `distanceMilesBetweenCoordinates` inside
// `lib/booking/writeBoundary.ts` (`atan2` form — the mobile travel-radius gate,
// and the miles snapshotted onto a waitlist offer), and a PRIVATE copy in
// `app/(main)/search/SearchMapClient.tsx` (`asin` form, map-recenter threshold).
// The three agreed to 1.4e-14 miles over 200k random pairs — they were the same
// function typed three times, and the booking one had a different NAME, which is
// why the fork guard could not see it.
//
// 🔴 Nothing may be imported here. This module is imported by a `'use client'`
// component; `lib/discovery/nearby.ts` cannot be, because it pulls
// `@prisma/client` in as a VALUE (`instanceof Prisma.Decimal`, `ProfessionType`
// enum members) and would drag the Prisma client into the browser bundle. Keep
// this file free of `@prisma/client`, `@/lib/time` and `@/lib/scheduling`, or
// that constraint quietly stops holding.
//
// ⚠️ NOT the same model as the PostGIS distance in `lib/search/pros.ts`
// (`ST_Distance(geom, …::geography)`), which is WGS84 SPHEROID and differs from
// this by up to ~0.5%. That one is the indexed prefilter and sort, it is correct
// where it is, and it is deliberately NOT collapsed into this.

/** Mean Earth radius in statute miles (IUGG mean radius, 6371.0088 km). */
const EARTH_RADIUS_MILES = 3958.7613

export type GeoPoint = { lat: number; lng: number }

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Great-circle distance between two WGS84 points, in statute miles.
 *
 * The `asin` form, clamped at 1 so floating-point drift just above unity cannot
 * produce `NaN` for two effectively identical points.
 */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)

  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)

  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))

  return EARTH_RADIUS_MILES * c
}
