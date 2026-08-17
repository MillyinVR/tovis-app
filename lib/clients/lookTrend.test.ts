// lib/clients/lookTrend.test.ts
//
// "Your Lived-in blonde is trending · +84 saves this week · top 3% in Brooklyn"
// is a public claim about a person's work. The cases that matter here are the
// ones where it would LIE: a look that barely moved, a city too small to rank
// in, and a rank that is technically true but reads as a boast when it is not
// one.

import { describe, expect, it, vi } from 'vitest'

import {
  getClientLookTrend,
  refreshClientLookTrendStats,
  TREND_CITY_PERCENTILE_FLOOR,
  TREND_MIN_RANKED_CITY_LOOKS,
  TREND_MIN_WEEKLY_SAVES,
  TREND_WINDOW_DAYS,
  trendWindowStart,
} from './lookTrend'

const NOW = new Date('2026-08-17T12:00:00.000Z')

type MoverRow = {
  lookPostId: string
  clientId: string
  publicCity: string | null
  cityKey: string | null
  weeklySaves: number
}

type CityRow = { cityKey: string; eligibleLooks: number }

/**
 * A PrismaClient stand-in. The refresh runs TWO raw aggregates concurrently —
 * the movers, then the per-city populations — so the mock answers in call order.
 */
function dbReturning(movers: MoverRow[], cities: CityRow[]) {
  const createMany = vi.fn()
  const deleteMany = vi.fn()
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce(movers)
    .mockResolvedValueOnce(cities)

  const db = {
    $queryRaw: queryRaw,
    $transaction: vi.fn().mockResolvedValue(undefined),
    clientLookTrendStat: { createMany, deleteMany },
  }

  return { db, createMany }
}

/** The rows handed to createMany, keyed by look. */
function written(createMany: ReturnType<typeof vi.fn>) {
  const call = createMany.mock.calls[0]
  if (!call) return new Map<string, Record<string, unknown>>()
  const data = (call[0] as { data: Record<string, unknown>[] }).data
  return new Map(data.map((row) => [row.lookPostId as string, row]))
}

function mover(
  id: string,
  weeklySaves: number,
  city: string | null = 'Brooklyn',
): MoverRow {
  return {
    lookPostId: id,
    clientId: `client-${id}`,
    publicCity: city,
    cityKey: city ? city.trim().toLowerCase() : null,
    weeklySaves,
  }
}

describe('trendWindowStart', () => {
  it('is a rolling instant subtraction, never a calendar week', () => {
    // A calendar week has to be resolved in SOMEBODY's timezone, and the only
    // zone an hourly job has is the server's (UTC on Vercel) — so "this week"
    // would quietly mean "this UTC week" for a creator in Brooklyn.
    expect(trendWindowStart(NOW).toISOString()).toBe('2026-08-10T12:00:00.000Z')
    expect(NOW.getTime() - trendWindowStart(NOW).getTime()).toBe(
      TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )
  })
})

describe('refreshClientLookTrendStats — the honest-signals floor', () => {
  it('writes no row for a look that barely moved', async () => {
    const { db, createMany } = dbReturning(
      [mover('a', TREND_MIN_WEEKLY_SAVES - 1)],
      [{ cityKey: 'brooklyn', eligibleLooks: 100 }],
    )

    const result = await refreshClientLookTrendStats(db as never, NOW)

    // Absence IS the read gate: no row means no banner, and no reader has to
    // re-implement (or forget) the floor.
    expect(result.trending).toBe(0)
    expect(createMany).not.toHaveBeenCalled()
  })

  it('writes a row the moment a look clears the floor', async () => {
    const { db, createMany } = dbReturning(
      [mover('a', TREND_MIN_WEEKLY_SAVES)],
      [{ cityKey: 'brooklyn', eligibleLooks: 100 }],
    )

    const result = await refreshClientLookTrendStats(db as never, NOW)

    expect(result.trending).toBe(1)
    expect(written(createMany).get('a')?.weeklySaves).toBe(
      TREND_MIN_WEEKLY_SAVES,
    )
  })

  it('still counts a below-floor look in its city’s field', async () => {
    // A look that moved a little is part of what the ranked look beat, even
    // though it will never render a banner of its own.
    const { db, createMany } = dbReturning(
      [
        mover('winner', 90),
        ...Array.from({ length: 40 }, (_, i) => mover(`m${i}`, 1)),
      ],
      [{ cityKey: 'brooklyn', eligibleLooks: 41 }],
    )

    await refreshClientLookTrendStats(db as never, NOW)

    // 40 below + itself: (40 + 0.5) / 41 → 99th percentile → "top 1%".
    expect(written(createMany).get('winner')?.cityPercentile).toBe(99)
  })
})

describe('refreshClientLookTrendStats — the city percentile', () => {
  it('says nothing about a city too small to rank in', async () => {
    const { db, createMany } = dbReturning(
      [mover('a', 50)],
      [{ cityKey: 'brooklyn', eligibleLooks: TREND_MIN_RANKED_CITY_LOOKS - 1 }],
    )

    await refreshClientLookTrendStats(db as never, NOW)

    const row = written(createMany).get('a')
    // The delta is still real and still renders; only the city clause goes.
    expect(row?.weeklySaves).toBe(50)
    expect(row?.cityPercentile).toBeNull()
    expect(row?.city).toBeNull()
  })

  it('refuses a rank that is not a distinction', async () => {
    // The lowest rank a trending look can hold is equal to ITSELF — over a
    // 20-look city that is percentile 3, which `topPercentFromPercentile` would
    // render as "top 97% in Brooklyn": true, meaningless, and a put-down under a
    // flame icon.
    const { db, createMany } = dbReturning(
      [
        mover('quiet', TREND_MIN_WEEKLY_SAVES),
        ...Array.from({ length: 19 }, (_, i) => mover(`loud${i}`, 500)),
      ],
      [{ cityKey: 'brooklyn', eligibleLooks: 20 }],
    )

    await refreshClientLookTrendStats(db as never, NOW)

    const row = written(createMany).get('quiet')
    expect(row?.weeklySaves).toBe(TREND_MIN_WEEKLY_SAVES)
    expect(row?.cityPercentile).toBeNull()
    expect(row?.city).toBeNull()
  })

  it('ranks against every eligible look, not just the ones that moved', async () => {
    // One mover in a city of 100 public looks is top 1%, not top 50% — the 99
    // that got nothing this week are part of the field the claim is about.
    const { db, createMany } = dbReturning(
      [mover('a', 84)],
      [{ cityKey: 'brooklyn', eligibleLooks: 100 }],
    )

    await refreshClientLookTrendStats(db as never, NOW)

    // (99 below + 0.5) / 100 → 100th percentile, clamped to "top 1%" at render.
    expect(written(createMany).get('a')?.cityPercentile).toBe(100)
  })

  it('says nothing about a creator who shows no city', async () => {
    const { db, createMany } = dbReturning(
      [mover('a', 84, null)],
      [{ cityKey: 'brooklyn', eligibleLooks: 100 }],
    )

    await refreshClientLookTrendStats(db as never, NOW)

    const row = written(createMany).get('a')
    expect(row?.weeklySaves).toBe(84)
    expect(row?.cityPercentile).toBeNull()
    expect(row?.city).toBeNull()
  })

  it('splits a tied block rather than crowning all of it', async () => {
    // Twenty looks all on the same number: plain "at or below" would hand every
    // one of them 100 and mint a page of "top 1% in Brooklyn".
    const { db, createMany } = dbReturning(
      Array.from({ length: 20 }, (_, i) => mover(`t${i}`, 40)),
      [{ cityKey: 'brooklyn', eligibleLooks: 20 }],
    )

    await refreshClientLookTrendStats(db as never, NOW)

    const rows = written(createMany)
    // (0 below + 20/2) / 20 = 50 — below the distinction floor, so nothing is
    // claimed about any of them.
    expect(TREND_CITY_PERCENTILE_FLOOR).toBeGreaterThan(50)
    for (const row of rows.values()) {
      expect(row.cityPercentile).toBeNull()
    }
  })

  it('groups a city case-insensitively and prints the author’s own spelling', async () => {
    const { db, createMany } = dbReturning(
      [
        { ...mover('a', 90), publicCity: 'Brooklyn', cityKey: 'brooklyn' },
        ...Array.from({ length: 25 }, (_, i) => ({
          ...mover(`b${i}`, 1),
          publicCity: 'brooklyn',
          cityKey: 'brooklyn',
        })),
      ],
      [{ cityKey: 'brooklyn', eligibleLooks: 26 }],
    )

    await refreshClientLookTrendStats(db as never, NOW)

    expect(written(createMany).get('a')?.city).toBe('Brooklyn')
  })
})

describe('refreshClientLookTrendStats — replacement', () => {
  it('replaces the whole table so a look that stopped moving loses its row', async () => {
    const { db } = dbReturning([], [])

    const result = await refreshClientLookTrendStats(db as never, NOW)

    // deleteMany is always queued; createMany only when there is something to
    // write. A stale row surviving would keep a dead banner on screen for an
    // hour after the momentum ended.
    expect(db.clientLookTrendStat.deleteMany).toHaveBeenCalledWith({})
    expect(db.clientLookTrendStat.createMany).not.toHaveBeenCalled()
    expect(result.trending).toBe(0)
    expect(result.ranked).toBe(0)
  })
})

describe('getClientLookTrend', () => {
  it('renders nothing when nothing of the client’s moved', async () => {
    const db = { clientLookTrendStat: { findFirst: vi.fn().mockResolvedValue(null) } }

    expect(await getClientLookTrend(db as never, 'client-1')).toBeNull()
  })

  it('converts the percentile into the “top N%” figure', async () => {
    const db = {
      clientLookTrendStat: {
        findFirst: vi.fn().mockResolvedValue({
          lookPostId: 'look-1',
          weeklySaves: 84,
          cityPercentile: 97,
          city: 'Brooklyn',
        }),
      },
    }

    expect(await getClientLookTrend(db as never, 'client-1')).toEqual({
      lookPostId: 'look-1',
      weeklySaves: 84,
      topPercent: 3,
      city: 'Brooklyn',
    })
  })

  it('drops the city half when the scorer declined to rank it', async () => {
    const db = {
      clientLookTrendStat: {
        findFirst: vi.fn().mockResolvedValue({
          lookPostId: 'look-1',
          weeklySaves: 84,
          cityPercentile: null,
          city: null,
        }),
      },
    }

    const trend = await getClientLookTrend(db as never, 'client-1')
    expect(trend?.weeklySaves).toBe(84)
    expect(trend?.topPercent).toBeNull()
    expect(trend?.city).toBeNull()
  })

  it('picks the best-moving look, tie-broken stably', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    await getClientLookTrend({ clientLookTrendStat: { findFirst } } as never, 'c1')

    // Two looks on the same number must not swap the banner on every page load
    // for a reason the client cannot see.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ weeklySaves: 'desc' }, { lookPostId: 'asc' }],
      }),
    )
  })
})
