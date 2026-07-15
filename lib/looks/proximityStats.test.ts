// lib/looks/proximityStats.test.ts
//
// Unit coverage for the serve-time proximity reader. The reader wraps a single
// professionalLocation IN-list read + haversine, so a plain vi.fn() mock exercises
// it end-to-end without Prisma.
import { describe, expect, it, vi } from 'vitest'

import { haversineMiles } from '@/lib/discovery/nearby'

import {
  fetchProProximitySignals,
  type ProProximityReaderDb,
} from './proximityStats'

type LocationRow = { professionalId: string; lat: unknown; lng: unknown }

function makeReaderDb(rows: LocationRow[]): ProProximityReaderDb & {
  professionalLocation: { findMany: ReturnType<typeof vi.fn> }
} {
  return {
    professionalLocation: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  }
}

// A viewer downtown; two pros — one nearby, one across town.
const VIEWER = { lat: 37.7749, lng: -122.4194 }
const NEARBY = { lat: 37.7799, lng: -122.4144 } // ~0.4mi
const ACROSS = { lat: 37.8716, lng: -122.2727 } // ~11mi (Berkeley)

describe('lib/looks/proximityStats', () => {
  describe('fetchProProximitySignals', () => {
    it('returns an empty map without a query for no ids', async () => {
      const db = makeReaderDb([])
      const map = await fetchProProximitySignals(db, [], VIEWER)
      expect(map.size).toBe(0)
      expect(db.professionalLocation.findMany).not.toHaveBeenCalled()
    })

    it('returns an empty map without a query for a non-finite viewer location', async () => {
      const db = makeReaderDb([])
      const map = await fetchProProximitySignals(db, ['pro_1'], {
        lat: Number.NaN,
        lng: -122,
      })
      expect(map.size).toBe(0)
      expect(db.professionalLocation.findMany).not.toHaveBeenCalled()
    })

    it('de-dupes + drops empty ids before the primary-location IN-list read', async () => {
      const db = makeReaderDb([])
      await fetchProProximitySignals(db, ['a', 'a', '', 'b'], VIEWER)
      expect(db.professionalLocation.findMany).toHaveBeenCalledWith({
        where: { professionalId: { in: ['a', 'b'] }, isPrimary: true, archivedAt: null },
        select: { professionalId: true, lat: true, lng: true },
      })
    })

    it('keys the viewer→pro distance by professionalId', async () => {
      const db = makeReaderDb([
        { professionalId: 'pro_near', lat: NEARBY.lat, lng: NEARBY.lng },
        { professionalId: 'pro_across', lat: ACROSS.lat, lng: ACROSS.lng },
      ])
      const map = await fetchProProximitySignals(
        db,
        ['pro_near', 'pro_across'],
        VIEWER,
      )
      expect(map.get('pro_near')?.distanceMiles).toBeCloseTo(
        haversineMiles(VIEWER, NEARBY),
        6,
      )
      expect(map.get('pro_across')?.distanceMiles).toBeCloseTo(
        haversineMiles(VIEWER, ACROSS),
        6,
      )
      // The nearby pro is genuinely closer.
      expect(map.get('pro_near')?.distanceMiles).toBeLessThan(
        map.get('pro_across')?.distanceMiles ?? Infinity,
      )
    })

    it('coerces Decimal-shaped (string) coordinates', async () => {
      const db = makeReaderDb([
        {
          professionalId: 'pro_str',
          lat: String(NEARBY.lat),
          lng: String(NEARBY.lng),
        },
      ])
      const map = await fetchProProximitySignals(db, ['pro_str'], VIEWER)
      expect(map.get('pro_str')?.distanceMiles).toBeCloseTo(
        haversineMiles(VIEWER, NEARBY),
        6,
      )
    })

    it('drops a pro whose primary location has no coordinate', async () => {
      const db = makeReaderDb([
        { professionalId: 'pro_noloc', lat: null, lng: null },
        { professionalId: 'pro_ok', lat: NEARBY.lat, lng: NEARBY.lng },
      ])
      const map = await fetchProProximitySignals(
        db,
        ['pro_noloc', 'pro_ok'],
        VIEWER,
      )
      // No coordinate → no distance to measure → absent from the map.
      expect(map.has('pro_noloc')).toBe(false)
      expect(map.has('pro_ok')).toBe(true)
    })
  })
})
