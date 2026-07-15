// lib/looks/badges/stats.test.ts
import { describe, expect, it, vi } from 'vitest'

import {
  fetchProUnderbookedSignals,
  mergeProfessionalBadgeStatRows,
  type ProUnderbookedReaderDb,
} from '@/lib/looks/badges/stats'

describe('mergeProfessionalBadgeStatRows', () => {
  it('merges the three grouped rowsets into one row per pro', () => {
    const rows = mergeProfessionalBadgeStatRows({
      recent: [{ professionalId: 'pro_a', count: 4 }],
      completed30d: [
        { professionalId: 'pro_a', count: 12 },
        { professionalId: 'pro_b', count: 9 },
      ],
      rebook: [
        {
          professionalId: 'pro_a',
          servedClientCount: 10,
          rebookedClientCount: 7,
        },
      ],
    })

    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.professionalId === 'pro_a')).toEqual({
      professionalId: 'pro_a',
      recentBookingCount: 4,
      completedBookingCount30d: 12,
      servedClientCount: 10,
      rebookedClientCount: 7,
    })
    expect(rows.find((row) => row.professionalId === 'pro_b')).toEqual({
      professionalId: 'pro_b',
      recentBookingCount: 0,
      completedBookingCount30d: 9,
      servedClientCount: 0,
      rebookedClientCount: 0,
    })
  })

  it('drops pros whose counts are all zero (missing row == all-zero)', () => {
    const rows = mergeProfessionalBadgeStatRows({
      recent: [{ professionalId: 'pro_zero', count: 0 }],
      completed30d: [],
      rebook: [],
    })
    expect(rows).toHaveLength(0)
  })

  it('keeps a pro known only from the rebook window', () => {
    const rows = mergeProfessionalBadgeStatRows({
      recent: [],
      completed30d: [],
      rebook: [
        {
          professionalId: 'pro_c',
          servedClientCount: 6,
          rebookedClientCount: 2,
        },
      ],
    })
    expect(rows).toEqual([
      {
        professionalId: 'pro_c',
        recentBookingCount: 0,
        completedBookingCount30d: 0,
        servedClientCount: 6,
        rebookedClientCount: 2,
      },
    ])
  })
})

describe('fetchProUnderbookedSignals', () => {
  function mockDb(
    rows: Array<{ professionalId: string; completedBookingCount30d: number }>,
  ) {
    const findMany = vi.fn().mockResolvedValue(rows)
    const db: ProUnderbookedReaderDb = {
      professionalBadgeStat: { findMany },
    }
    return { db, findMany }
  }

  it('maps completed-booking volume by professionalId', async () => {
    const { db } = mockDb([
      { professionalId: 'pro_a', completedBookingCount30d: 12 },
      { professionalId: 'pro_b', completedBookingCount30d: 0 },
    ])

    const signals = await fetchProUnderbookedSignals(db, ['pro_a', 'pro_b'])

    expect(signals.get('pro_a')).toEqual({ completedBookingCount30d: 12 })
    expect(signals.get('pro_b')).toEqual({ completedBookingCount30d: 0 })
  })

  it('leaves a pro without a row absent (reads as 0 completed downstream)', async () => {
    const { db } = mockDb([
      { professionalId: 'pro_a', completedBookingCount30d: 5 },
    ])

    const signals = await fetchProUnderbookedSignals(db, ['pro_a', 'pro_missing'])

    expect(signals.has('pro_missing')).toBe(false)
    expect(signals.size).toBe(1)
  })

  it('de-dupes and drops empty ids before querying', async () => {
    const { db, findMany } = mockDb([])

    await fetchProUnderbookedSignals(db, ['pro_a', 'pro_a', '', 'pro_b'])

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]?.[0].where.professionalId.in).toEqual([
      'pro_a',
      'pro_b',
    ])
  })

  it('short-circuits without querying for an empty id list', async () => {
    const { db, findMany } = mockDb([])

    const signals = await fetchProUnderbookedSignals(db, ['', '  '.trim()])

    expect(signals.size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
