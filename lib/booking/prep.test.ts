import { BookingStatus } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  isPrepWritableStatus,
  selectPrepItemsForOffering,
} from '@/lib/booking/prep'

const row = (
  id: string,
  offeringId: string | null,
  sortOrder = 0,
): { id: string; text: string; sortOrder: number; offeringId: string | null } => ({
  id,
  text: `row ${id}`,
  sortOrder,
  offeringId,
})

describe('selectPrepItemsForOffering', () => {
  it('uses the pro default list when the offering has written none', () => {
    const result = selectPrepItemsForOffering(
      [row('d1', null, 0), row('d2', null, 1)],
      'offering_1',
    )

    expect(result.source).toBe('PROFESSIONAL')
    expect(result.items.map((i) => i.id)).toEqual(['d1', 'd2'])
  })

  it("REPLACES the default with the offering's own list rather than merging", () => {
    // The whole point of the override: a pro who writes one row for a brow
    // shape means "for a brow shape, this row" — not "this row plus everything
    // I say about balayage". A merge would make a default row unremovable for
    // a single service.
    const result = selectPrepItemsForOffering(
      [row('d1', null), row('d2', null), row('o1', 'offering_1')],
      'offering_1',
    )

    expect(result.source).toBe('OFFERING')
    expect(result.items.map((i) => i.id)).toEqual(['o1'])
  })

  it("never leaks another offering's rows", () => {
    const result = selectPrepItemsForOffering(
      [row('d1', null), row('other', 'offering_2')],
      'offering_1',
    )

    expect(result.source).toBe('PROFESSIONAL')
    expect(result.items.map((i) => i.id)).toEqual(['d1'])
  })

  it('falls back to the default list for a booking with no offering', () => {
    const result = selectPrepItemsForOffering(
      [row('d1', null), row('o1', 'offering_1')],
      null,
    )

    expect(result.source).toBe('PROFESSIONAL')
    expect(result.items.map((i) => i.id)).toEqual(['d1'])
  })

  it('reports NONE when the pro has written nothing at all', () => {
    const result = selectPrepItemsForOffering([], 'offering_1')

    expect(result.source).toBe('NONE')
    expect(result.items).toEqual([])
  })
})

describe('isPrepWritableStatus', () => {
  it('accepts a booking that has not happened yet', () => {
    expect(isPrepWritableStatus(BookingStatus.PENDING)).toBe(true)
    expect(isPrepWritableStatus(BookingStatus.ACCEPTED)).toBe(true)
  })

  it('refuses every terminal or in-flight state', () => {
    // Ticking "arrive with clean hair" on a cancelled or finished appointment
    // writes a row nobody will ever read.
    expect(isPrepWritableStatus(BookingStatus.IN_PROGRESS)).toBe(false)
    expect(isPrepWritableStatus(BookingStatus.COMPLETED)).toBe(false)
    expect(isPrepWritableStatus(BookingStatus.CANCELLED)).toBe(false)
    expect(isPrepWritableStatus(BookingStatus.NO_SHOW)).toBe(false)
  })

  it('covers every BookingStatus the schema declares', () => {
    // A new status must be a deliberate decision here, not an implicit refuse.
    for (const status of Object.values(BookingStatus)) {
      expect(typeof isPrepWritableStatus(status)).toBe('boolean')
    }
    expect(Object.values(BookingStatus)).toHaveLength(6)
  })
})
