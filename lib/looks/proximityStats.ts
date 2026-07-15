// lib/looks/proximityStats.ts
//
// Serve-time proximity reader — the per-pro distance primitive behind the Looks
// feed proximity_fit ranking term (personalization spec §4.5 travel radius).
// Mirrors the other §4.2/§4.5 serve readers (availabilityStats / conversionStats):
// a cheap, indexed IN-list read for a page's pros, keyed by professionalId, that
// the pure ranker consumes as a plain number.
//
// Unlike the aggregate readers, there is NO cron and NO stored table: a pro's
// primary-location coordinate already lives on ProfessionalLocation, and the
// viewer's "here" is the request's (optional, range-checked) viewer location. This
// reader joins the two — reading each candidate pro's primary-location lat/lng and
// computing the great-circle distance to the viewer — and returns the distance so
// the ranker never touches geo math or Prisma (keeping personalizedRanking.ts pure,
// exactly as ProAvailabilitySignal keeps the calendar math out of it).
//
// The distance is a SOFT weight, never a hard filter (guardrail #8): a pro with no
// primary-location coordinate is simply absent from the map (boost 0), and the feed
// is byte-identical when the request carries no viewer location (the caller skips
// this read entirely). The pro's BUSINESS location is not client PII — the same
// primary-location coordinates the DISTANCE badge already reads at serve time
// (lib/looks/badges/attach.ts) — so it is read plainly here too.

import { haversineMiles } from '@/lib/discovery/nearby'
import type { ProProximitySignal } from '@/lib/looks/personalizedRanking'

/** The viewer's current location (the request's range-checked viewerLat/Lng). */
export type ProximityViewerLocation = {
  lat: number
  lng: number
}

/**
 * The exact ProfessionalLocation read the serve-time reader needs, expressed
 * structurally so both PrismaClient and a plain test mock satisfy it without a
 * type escape (the LookConversionReaderDb / ProUnderbookedReaderDb pattern). lat/lng
 * are Prisma Decimal? at runtime, so they arrive as `unknown` and are coerced.
 */
export type ProProximityReaderDb = {
  professionalLocation: {
    findMany(args: {
      where: { professionalId: { in: string[] }; isPrimary: true; archivedAt: null }
      select: { professionalId: true; lat: true; lng: true }
    }): PromiseLike<Array<{ professionalId: string; lat: unknown; lng: unknown }>>
  }
}

/** Prisma Decimal (or anything decimal-shaped) → finite number, else null. */
function coerceCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const parsed = Number(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Serve-time reader for the §4.5 proximity_fit boost: the viewer→pro great-circle
 * distance for a page's pros, keyed by professionalId. Reads each pro's PRIMARY,
 * non-archived location coordinate (one indexed IN-list read on the
 * (professionalId, isPrimary) index) and computes miles from the viewer. A pro with
 * no primary-location coordinate — or one that fails coercion — is simply absent
 * from the map; the ranker reads that as no distance to measure → boost 0. Returns
 * an empty map (no query) for no ids or a non-finite viewer location.
 */
export async function fetchProProximitySignals(
  db: ProProximityReaderDb,
  professionalIds: readonly string[],
  viewer: ProximityViewerLocation,
): Promise<Map<string, ProProximitySignal>> {
  const map = new Map<string, ProProximitySignal>()

  if (!Number.isFinite(viewer.lat) || !Number.isFinite(viewer.lng)) return map

  const ids = [...new Set(professionalIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return map

  const rows = await db.professionalLocation.findMany({
    where: { professionalId: { in: ids }, isPrimary: true, archivedAt: null },
    select: { professionalId: true, lat: true, lng: true },
  })

  for (const row of rows) {
    // One primary location per pro; take the first, ignore any dupes.
    if (map.has(row.professionalId)) continue
    const lat = coerceCoordinate(row.lat)
    const lng = coerceCoordinate(row.lng)
    if (lat === null || lng === null) continue
    const miles = haversineMiles(
      { lat: viewer.lat, lng: viewer.lng },
      { lat, lng },
    )
    if (!Number.isFinite(miles)) continue
    map.set(row.professionalId, { distanceMiles: miles })
  }

  return map
}
