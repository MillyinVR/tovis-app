// lib/looks/conversionStats.test.ts
//
// Unit coverage for the serve-time reader. refreshLookPostConversionStats (the
// raw-SQL aggregate + swap) is covered against real Postgres in
// tests/integration/look-conversion-stats.test.ts — a mocked $queryRaw would only
// test the mock.
import { describe, expect, it, vi } from 'vitest'

import {
  fetchLookConversionSignals,
  type LookConversionReaderDb,
} from './conversionStats'

function makeReaderDb(
  rows: Array<{ lookPostId: string; bookingCount: number; interestCount: number }>,
): LookConversionReaderDb & {
  lookPostConversionStat: { findMany: ReturnType<typeof vi.fn> }
} {
  return {
    lookPostConversionStat: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  }
}

describe('lib/looks/conversionStats', () => {
  describe('fetchLookConversionSignals', () => {
    it('returns an empty map without a query for no ids', async () => {
      const db = makeReaderDb([])
      const map = await fetchLookConversionSignals(db, [])
      expect(map.size).toBe(0)
      expect(db.lookPostConversionStat.findMany).not.toHaveBeenCalled()
    })

    it('de-dupes + drops empty ids before the IN-list read', async () => {
      const db = makeReaderDb([])
      await fetchLookConversionSignals(db, ['a', 'a', '', 'b'])
      expect(db.lookPostConversionStat.findMany).toHaveBeenCalledWith({
        where: { lookPostId: { in: ['a', 'b'] } },
        select: { lookPostId: true, bookingCount: true, interestCount: true },
      })
    })

    it('keys the returned signals by lookPostId', async () => {
      const db = makeReaderDb([
        { lookPostId: 'look_1', bookingCount: 3, interestCount: 120 },
        { lookPostId: 'look_2', bookingCount: 1, interestCount: 5 },
      ])
      const map = await fetchLookConversionSignals(db, ['look_1', 'look_2'])
      expect(map.get('look_1')).toEqual({ bookingCount: 3, interestCount: 120 })
      expect(map.get('look_2')).toEqual({ bookingCount: 1, interestCount: 5 })
      // A look with no row is simply absent → no conversion evidence.
      expect(map.has('look_3')).toBe(false)
    })
  })
})
