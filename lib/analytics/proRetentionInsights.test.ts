import { describe, it, expect } from 'vitest'

import {
  bucketRetentionClients,
  buildRebookTrend,
  cadenceLabel,
  elapsedLabel,
  headlineFromTrend,
  rebookRatePct,
  recentMonthKeys,
  type RetentionClientSummary,
  type RetentionSnapshotRow,
} from './proRetentionInsights'

const NOW = new Date('2026-08-04T17:00:00Z')

describe('recentMonthKeys', () => {
  it('walks back across a year boundary, oldest first', () => {
    expect(recentMonthKeys(new Date('2026-02-10T12:00:00Z'), 'UTC', 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })

  it('anchors to the PRO timezone, not the server zone', () => {
    // 2026-03-01T02:00Z is still February 28th in Los Angeles, so a pro there is
    // looking at a window that ends in February.
    const la = recentMonthKeys(new Date('2026-03-01T02:00:00Z'), 'America/Los_Angeles', 1)
    const utc = recentMonthKeys(new Date('2026-03-01T02:00:00Z'), 'UTC', 1)
    expect(la).toEqual(['2026-02'])
    expect(utc).toEqual(['2026-03'])
  })
})

describe('rebookRatePct', () => {
  it('divides by the clients the snapshot actually classified', () => {
    expect(
      rebookRatePct({ futureRebookedClientCount: 3, noFutureRebookClientCount: 1 }),
    ).toBe(75)
  })

  // 🔴 The honesty case. A month nobody was classified in is NOT a 0% month —
  // 0% reads as "every client left and never rebooked", which would be a lie.
  it('returns null (a gap), never 0, when nothing was classified', () => {
    expect(
      rebookRatePct({ futureRebookedClientCount: 0, noFutureRebookClientCount: 0 }),
    ).toBeNull()
  })

  it('a real zero is still a zero', () => {
    expect(
      rebookRatePct({ futureRebookedClientCount: 0, noFutureRebookClientCount: 5 }),
    ).toBe(0)
  })
})

describe('buildRebookTrend', () => {
  const rows: RetentionSnapshotRow[] = [
    {
      monthKey: '2026-07',
      uniqueClientCount: 10,
      newClientCount: 3,
      repeatClientCount: 7,
      futureRebookedClientCount: 6,
      noFutureRebookClientCount: 4,
    },
  ]

  it('keeps a month with no snapshot as a null point, not a zero row', () => {
    const trend = buildRebookTrend({
      monthKeys: ['2026-06', '2026-07'],
      rows,
      timeZone: 'UTC',
    })
    expect(trend.map((p) => p.monthKey)).toEqual(['2026-06', '2026-07'])
    expect(trend[0]?.rebookRatePct).toBeNull()
    expect(trend[1]?.rebookRatePct).toBe(60)
  })

  it('labels months in the pro timezone without rolling into a neighbour', () => {
    const trend = buildRebookTrend({
      monthKeys: ['2026-01', '2026-12'],
      rows: [],
      timeZone: 'Pacific/Kiritimati',
    })
    expect(trend[0]?.monthLabel).toBe('Jan')
    expect(trend[1]?.monthLabel).toBe('Dec')
  })
})

describe('headlineFromTrend', () => {
  const point = (monthKey: string, rebookRatePct: number | null) => ({
    monthKey,
    monthLabel: monthKey,
    rebookRatePct,
    clientsSeen: 0,
    newClients: 0,
    repeatClients: 0,
  })

  it('compares the two most recent MEASURED months, skipping gaps', () => {
    expect(
      headlineFromTrend([point('a', 40), point('b', null), point('c', 55)]),
    ).toEqual({ headlineRebookRatePct: 55, headlineDeltaPoints: 15 })
  })

  it('reports no delta when only one month is measured', () => {
    expect(headlineFromTrend([point('a', null), point('b', 30)])).toEqual({
      headlineRebookRatePct: 30,
      headlineDeltaPoints: null,
    })
  })

  it('is null-safe when nothing is measured at all', () => {
    expect(headlineFromTrend([point('a', null)])).toEqual({
      headlineRebookRatePct: null,
      headlineDeltaPoints: null,
    })
  })
})

describe('bucketRetentionClients', () => {
  const client = (
    over: Partial<RetentionClientSummary> & { clientId: string },
  ): RetentionClientSummary => ({
    displayName: 'A Client',
    completedVisits: 4,
    cadenceDays: 42,
    daysSinceLastVisit: 10,
    hasUpcoming: false,
    retentionRisk: false,
    ...over,
  })

  it('books-on-file wins over every lapse signal', () => {
    const { buckets } = bucketRetentionClients([
      client({ clientId: 'c1', hasUpcoming: true, retentionRisk: true, daysSinceLastVisit: 400 }),
    ])
    expect(buckets.find((b) => b.key === 'on_the_books')?.count).toBe(1)
    expect(buckets.find((b) => b.key === 'lapsing')?.count).toBe(0)
  })

  it('separates lapsing from merely due, and leaves the not-yet-due alone', () => {
    const { buckets } = bucketRetentionClients([
      client({ clientId: 'lapsed', retentionRisk: true, daysSinceLastVisit: 90 }),
      client({ clientId: 'due', daysSinceLastVisit: 45 }),
      client({ clientId: 'early', daysSinceLastVisit: 5 }),
    ])
    expect(buckets.find((b) => b.key === 'lapsing')?.count).toBe(1)
    expect(buckets.find((b) => b.key === 'due_now')?.count).toBe(1)
    expect(buckets.find((b) => b.key === 'on_the_books')?.count).toBe(0)
    // "early" is in no bucket — not due yet is not a state worth flagging.
  })

  // 🔴 A single-visit client has no cadence, so calling them "due back" would be
  // an invention. They are counted separately and never named in a bucket.
  it('holds out clients with no cadence instead of guessing at them', () => {
    const { buckets, notEnoughHistoryCount } = bucketRetentionClients([
      client({ clientId: 'once', cadenceDays: null, completedVisits: 1 }),
      client({ clientId: 'never', cadenceDays: null, daysSinceLastVisit: null, completedVisits: 0 }),
    ])
    expect(notEnoughHistoryCount).toBe(2)
    for (const bucket of buckets) expect(bucket.count).toBe(0)
  })

  it('previews the most overdue first and caps the named list', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      client({
        clientId: `c${i}`,
        displayName: `Client ${i}`,
        retentionRisk: true,
        daysSinceLastVisit: 100 + i,
      }),
    )
    const lapsing = bucketRetentionClients(many).buckets.find(
      (b) => b.key === 'lapsing',
    )
    expect(lapsing?.count).toBe(9)
    expect(lapsing?.clients).toHaveLength(6)
    expect(lapsing?.clients[0]?.displayName).toBe('Client 8')
  })
})

describe('labels', () => {
  it('scales elapsed time to days / weeks / months', () => {
    expect(elapsedLabel(null)).toBeNull()
    expect(elapsedLabel(0)).toBe('today')
    expect(elapsedLabel(1)).toBe('1 day ago')
    expect(elapsedLabel(30)).toBe('4 wks ago')
    expect(elapsedLabel(180)).toBe('6 mo ago')
  })

  it('states cadence in the roster voice', () => {
    expect(cadenceLabel(null)).toBeNull()
    expect(cadenceLabel(42)).toBe('usually every 6 wks')
    expect(cadenceLabel(3)).toBe('usually every 3 days')
  })
})

// Sanity anchor so the NOW constant above is exercised rather than dangling.
describe('module wiring', () => {
  it('derives a month window ending at the current month', () => {
    expect(recentMonthKeys(NOW, 'UTC', 6).at(-1)).toBe('2026-08')
  })
})
