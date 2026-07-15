// lib/looks/badges/stats.test.ts
import { describe, expect, it, vi } from 'vitest'

import {
  fetchProReliabilitySignals,
  fetchProUnderbookedSignals,
  mergeProfessionalBadgeStatRows,
  type ProReliabilityReaderDb,
  type ProUnderbookedReaderDb,
} from '@/lib/looks/badges/stats'

describe('mergeProfessionalBadgeStatRows', () => {
  it('merges the four grouped rowsets into one row per pro', () => {
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
      reliability: [
        {
          professionalId: 'pro_a',
          resolvedBookingCount: 15,
          completedResolvedCount: 14,
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
      resolvedBookingCount: 15,
      completedResolvedCount: 14,
    })
    expect(rows.find((row) => row.professionalId === 'pro_b')).toEqual({
      professionalId: 'pro_b',
      recentBookingCount: 0,
      completedBookingCount30d: 9,
      servedClientCount: 0,
      rebookedClientCount: 0,
      resolvedBookingCount: 0,
      completedResolvedCount: 0,
    })
  })

  it('drops pros whose counts are all zero (missing row == all-zero)', () => {
    const rows = mergeProfessionalBadgeStatRows({
      recent: [{ professionalId: 'pro_zero', count: 0 }],
      completed30d: [],
      rebook: [],
      reliability: [],
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
      reliability: [],
    })
    expect(rows).toEqual([
      {
        professionalId: 'pro_c',
        recentBookingCount: 0,
        completedBookingCount30d: 0,
        servedClientCount: 6,
        rebookedClientCount: 2,
        resolvedBookingCount: 0,
        completedResolvedCount: 0,
      },
    ])
  })

  it('folds reliability counts onto a pro kept by another window', () => {
    const rows = mergeProfessionalBadgeStatRows({
      recent: [],
      completed30d: [{ professionalId: 'pro_d', count: 5 }],
      rebook: [],
      reliability: [
        {
          professionalId: 'pro_d',
          resolvedBookingCount: 8,
          completedResolvedCount: 6,
        },
      ],
    })
    expect(rows).toEqual([
      {
        professionalId: 'pro_d',
        recentBookingCount: 0,
        completedBookingCount30d: 5,
        servedClientCount: 0,
        rebookedClientCount: 0,
        resolvedBookingCount: 8,
        completedResolvedCount: 6,
      },
    ])
  })

  it('drops a pro known ONLY from the reliability window (all-cancel, no completions)', () => {
    // A pro with resolved cancellations but no completed/served/recent count is
    // dropped — the reliability boost is 0 for an absent pro anyway (it only ever
    // lifts), so storing them would just bloat the table.
    const rows = mergeProfessionalBadgeStatRows({
      recent: [],
      completed30d: [],
      rebook: [],
      reliability: [
        {
          professionalId: 'pro_cancels',
          resolvedBookingCount: 4,
          completedResolvedCount: 0,
        },
      ],
    })
    expect(rows).toHaveLength(0)
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

describe('fetchProReliabilitySignals', () => {
  function mockDb(
    rows: Array<{
      professionalId: string
      resolvedBookingCount: number
      completedResolvedCount: number
    }>,
  ) {
    const findMany = vi.fn().mockResolvedValue(rows)
    const db: ProReliabilityReaderDb = {
      professionalBadgeStat: { findMany },
    }
    return { db, findMany }
  }

  it('maps resolved + completed counts by professionalId', async () => {
    const { db } = mockDb([
      {
        professionalId: 'pro_a',
        resolvedBookingCount: 15,
        completedResolvedCount: 14,
      },
      {
        professionalId: 'pro_b',
        resolvedBookingCount: 4,
        completedResolvedCount: 1,
      },
    ])

    const signals = await fetchProReliabilitySignals(db, ['pro_a', 'pro_b'])

    expect(signals.get('pro_a')).toEqual({
      resolvedBookingCount: 15,
      completedResolvedCount: 14,
    })
    expect(signals.get('pro_b')).toEqual({
      resolvedBookingCount: 4,
      completedResolvedCount: 1,
    })
  })

  it('leaves a pro without a row absent (reads as no reliability evidence)', async () => {
    const { db } = mockDb([
      {
        professionalId: 'pro_a',
        resolvedBookingCount: 10,
        completedResolvedCount: 9,
      },
    ])

    const signals = await fetchProReliabilitySignals(db, ['pro_a', 'pro_missing'])

    expect(signals.has('pro_missing')).toBe(false)
    expect(signals.size).toBe(1)
  })

  it('de-dupes and drops empty ids before querying', async () => {
    const { db, findMany } = mockDb([])

    await fetchProReliabilitySignals(db, ['pro_a', 'pro_a', '', 'pro_b'])

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]?.[0].where.professionalId.in).toEqual([
      'pro_a',
      'pro_b',
    ])
  })

  it('short-circuits without querying for an empty id list', async () => {
    const { db, findMany } = mockDb([])

    const signals = await fetchProReliabilitySignals(db, ['', '  '.trim()])

    expect(signals.size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
