// lib/looks/badges/stats.test.ts
import { describe, expect, it } from 'vitest'

import { mergeProfessionalBadgeStatRows } from '@/lib/looks/badges/stats'

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
