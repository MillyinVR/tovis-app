import { BookingStatus } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import {
  isPrepWritableStatus,
  pickPrepNote,
  resolvePrepForBookings,
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

describe('pickPrepNote', () => {
  it("prefers the offering's note over the pro's default", () => {
    expect(pickPrepNote('for this service', 'my default')).toBe('for this service')
  })

  it('falls through a blank offering note to the default', () => {
    // An all-whitespace note is not a note. Without this an empty textarea on
    // one offering would silently suppress the pro's real default.
    expect(pickPrepNote('   \n ', 'my default')).toBe('my default')
    expect(pickPrepNote(null, 'my default')).toBe('my default')
    expect(pickPrepNote(undefined, '  ')).toBeNull()
  })
})

describe('resolvePrepForBookings (batch)', () => {
  /**
   * A stub that answers the three reads the batch resolver makes, and COUNTS
   * them — the whole reason this function exists is that the per-booking
   * resolver would issue ~4 queries × up to 300 bookings on the client's
   * appointments list.
   */
  function stubDb(args: {
    rows: {
      id: string
      text: string
      sortOrder: number
      offeringId: string | null
      professionalId: string
    }[]
  }) {
    const calls = { proPrepItem: 0 }
    const db = {
      proPrepItem: {
        findMany: vi.fn(async () => {
          calls.proPrepItem += 1
          return args.rows
        }),
      },
    }
    return { db, calls }
  }

  it('resolves many bookings without a per-booking query fan-out', async () => {
    const { db, calls } = stubDb({
      rows: [
        { id: 'd1', text: 'default', sortOrder: 0, offeringId: null, professionalId: 'pro_1' },
        { id: 'o1', text: 'balayage', sortOrder: 0, offeringId: 'off_1', professionalId: 'pro_1' },
        { id: 'p2', text: 'other pro', sortOrder: 0, offeringId: null, professionalId: 'pro_2' },
      ],
    })

    const result = await resolvePrepForBookings(
      db,
      [
        {
          bookingId: 'bk_a',
          professionalId: 'pro_1',
          offeringId: 'off_1',
          offeringPrepNote: 'three hours in the chair',
          professionalPrepNote: 'come as you are',
        },
        {
          bookingId: 'bk_b',
          professionalId: 'pro_1',
          offeringId: null,
          offeringPrepNote: null,
          professionalPrepNote: 'come as you are',
        },
        {
          bookingId: 'bk_c',
          professionalId: 'pro_2',
          offeringId: null,
          offeringPrepNote: null,
          professionalPrepNote: null,
        },
      ],
    )

    // Three bookings, two pros — and exactly ONE query. Both notes ride
    // relations the caller already loaded, so they cost nothing here.
    expect(calls).toEqual({ proPrepItem: 1 })

    // The offering's list REPLACES the default, and its note wins.
    expect(result.get('bk_a')?.items.map((i) => i.id)).toEqual(['o1'])
    expect(result.get('bk_a')?.source).toBe('OFFERING')
    expect(result.get('bk_a')?.note).toBe('three hours in the chair')

    // Same pro, no offering → the default list and the pro's own note.
    expect(result.get('bk_b')?.items.map((i) => i.id)).toEqual(['d1'])
    expect(result.get('bk_b')?.note).toBe('come as you are')

    // 🔴 A second pro's rows must not leak into the first pro's bookings, and
    // vice versa — the batch query spans every pro in the set.
    expect(result.get('bk_c')?.items.map((i) => i.id)).toEqual(['p2'])
    expect(result.get('bk_a')?.items.map((i) => i.id)).not.toContain('p2')
    expect(result.get('bk_c')?.note).toBeNull()
  })

  it("never leaks a sibling offering's rows into another booking", async () => {
    const { db } = stubDb({
      rows: [
        { id: 'd1', text: 'default', sortOrder: 0, offeringId: null, professionalId: 'pro_1' },
        { id: 'o1', text: 'balayage', sortOrder: 0, offeringId: 'off_1', professionalId: 'pro_1' },
        { id: 'o2', text: 'brows', sortOrder: 0, offeringId: 'off_2', professionalId: 'pro_1' },
      ],
    })

    const result = await resolvePrepForBookings(
      db,
      [
        { bookingId: 'bk_a', professionalId: 'pro_1', offeringId: 'off_1' },
        { bookingId: 'bk_b', professionalId: 'pro_1', offeringId: 'off_2' },
      ],
    )

    expect(result.get('bk_a')?.items.map((i) => i.id)).toEqual(['o1'])
    expect(result.get('bk_b')?.items.map((i) => i.id)).toEqual(['o2'])
  })

  it('issues no queries at all for an empty set', async () => {
    const { db, calls } = stubDb({ rows: [] })

    const result = await resolvePrepForBookings(db, [])

    expect(result.size).toBe(0)
    expect(calls).toEqual({ proPrepItem: 0 })
  })

  it('gives a pro with no rows an entry rather than a hole', async () => {
    // A caller must not have to tell "not loaded" from "nothing to prep".
    const { db } = stubDb({
      rows: [],
    })

    const result = await resolvePrepForBookings(
      db,
      [{ bookingId: 'bk_a', professionalId: 'pro_1', offeringId: null }],
    )

    expect(result.get('bk_a')).toEqual({ items: [], source: 'NONE', note: null })
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
