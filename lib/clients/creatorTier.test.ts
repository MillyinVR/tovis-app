// lib/clients/creatorTier.test.ts
//
// The tier is a public claim about a person ("top 5% saver"), so the cases that
// matter here are the ones where a percentile would LIE: too few creators to
// rank against, a field that is all tied, and the single best creator.

import { describe, expect, it, vi } from 'vitest'
import { ClientCreatorTier } from '@prisma/client'

import {
  CREATOR_TIER_MIN_PUBLIC_LOOKS,
  CREATOR_TIER_MIN_RANKED_POPULATION,
  refreshClientCreatorStats,
  tierForSavePercentile,
  topPercentFromPercentile,
} from './creatorTier'

const NOW = new Date('2026-08-13T12:00:00.000Z')

type Row = {
  clientId: string
  totalSaves: number
  totalRecreations: number
  publicLookCount: number
}

/** A PrismaClient stand-in that returns `rows` from the aggregate. */
function dbReturning(rows: Row[]) {
  const createMany = vi.fn()
  const deleteMany = vi.fn()
  const db = {
    $queryRaw: vi.fn().mockResolvedValue(rows),
    $transaction: vi.fn().mockResolvedValue(undefined),
    clientCreatorStat: { createMany, deleteMany },
  }
  return { db, createMany }
}

/** The rows handed to createMany, keyed by client. */
function written(createMany: ReturnType<typeof vi.fn>) {
  const call = createMany.mock.calls[0]
  if (!call) return new Map<string, Record<string, unknown>>()
  const data = (call[0] as { data: Record<string, unknown>[] }).data
  return new Map(data.map((row) => [row.clientId as string, row]))
}

function creators(count: number, savesAt: (index: number) => number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    clientId: `c${i}`,
    totalSaves: savesAt(i),
    totalRecreations: 0,
    publicLookCount: CREATOR_TIER_MIN_PUBLIC_LOOKS,
  }))
}

describe('tierForSavePercentile', () => {
  it('leaves an unranked creator untiered rather than bottom-tiered', () => {
    expect(tierForSavePercentile(null)).toBe(ClientCreatorTier.NONE)
  })

  it('grades the bands', () => {
    expect(tierForSavePercentile(0)).toBe(ClientCreatorTier.NONE)
    expect(tierForSavePercentile(74)).toBe(ClientCreatorTier.NONE)
    expect(tierForSavePercentile(75)).toBe(ClientCreatorTier.RISING)
    expect(tierForSavePercentile(94)).toBe(ClientCreatorTier.RISING)
    expect(tierForSavePercentile(95)).toBe(ClientCreatorTier.TASTEMAKER)
    expect(tierForSavePercentile(100)).toBe(ClientCreatorTier.TASTEMAKER)
  })
})

describe('topPercentFromPercentile', () => {
  it('has no figure for an unranked creator', () => {
    expect(topPercentFromPercentile(null)).toBeNull()
  })

  it('reads as "top 5%" at the Tastemaker cut', () => {
    expect(topPercentFromPercentile(95)).toBe(5)
  })

  it('never says "top 0%" for the single best creator', () => {
    expect(topPercentFromPercentile(100)).toBe(1)
  })
})

describe('refreshClientCreatorStats', () => {
  it('ranks nobody when the population is below the floor', async () => {
    // One prolific creator, alone. Any formula either crowns or bottoms them,
    // and both are lies — so nobody is ranked.
    const { db, createMany } = dbReturning(creators(1, () => 5_000))

    const result = await refreshClientCreatorStats(db as never, NOW)

    expect(result.ranked).toBe(0)
    const rows = written(createMany)
    expect(rows.get('c0')?.savePercentile).toBeNull()
    expect(rows.get('c0')?.tier).toBe(ClientCreatorTier.NONE)
  })

  it('still writes a row for an unranked creator, carrying the real counts', async () => {
    const { db, createMany } = dbReturning([
      { clientId: 'c0', totalSaves: 42, totalRecreations: 7, publicLookCount: 1 },
    ])

    await refreshClientCreatorStats(db as never, NOW)

    const row = written(createMany).get('c0')
    expect(row).toMatchObject({
      totalSaves: 42,
      totalRecreations: 7,
      publicLookCount: 1,
      savePercentile: null,
      computedAt: NOW,
    })
  })

  it('leaves a creator below the minimum-looks floor unranked', async () => {
    const rows = creators(CREATOR_TIER_MIN_RANKED_POPULATION, (i) => i * 10)
    rows.push({
      clientId: 'oneHit',
      // More saves than anyone, but on a single look.
      totalSaves: 10_000,
      totalRecreations: 0,
      publicLookCount: CREATOR_TIER_MIN_PUBLIC_LOOKS - 1,
    })
    const { db, createMany } = dbReturning(rows)

    await refreshClientCreatorStats(db as never, NOW)

    const written_ = written(createMany)
    expect(written_.get('oneHit')?.savePercentile).toBeNull()
    expect(written_.get('oneHit')?.tier).toBe(ClientCreatorTier.NONE)
  })

  it('puts the most-saved creator in the top band once the field is big enough', async () => {
    const { db, createMany } = dbReturning(
      creators(CREATOR_TIER_MIN_RANKED_POPULATION, (i) => i * 10),
    )

    const result = await refreshClientCreatorStats(db as never, NOW)

    expect(result.ranked).toBe(CREATOR_TIER_MIN_RANKED_POPULATION)
    const rows = written(createMany)
    const best = rows.get(`c${CREATOR_TIER_MIN_RANKED_POPULATION - 1}`)
    expect(best?.tier).toBe(ClientCreatorTier.TASTEMAKER)
    expect(rows.get('c0')?.tier).toBe(ClientCreatorTier.NONE)
  })

  it('does not crown a field where everyone is tied', async () => {
    // The failure mode of a plain "at or below" percentile: every creator is
    // level, so every creator is "top 0%" and the whole field is Tastemaker.
    const { db, createMany } = dbReturning(
      creators(CREATOR_TIER_MIN_RANKED_POPULATION, () => 100),
    )

    await refreshClientCreatorStats(db as never, NOW)

    const rows = [...written(createMany).values()]
    expect(rows).not.toHaveLength(0)
    expect(rows.every((row) => row.tier === ClientCreatorTier.NONE)).toBe(true)
    expect(rows.every((row) => row.savePercentile === 50)).toBe(true)
  })

  it('replaces the table contents atomically', async () => {
    const { db } = dbReturning(creators(1, () => 1))

    await refreshClientCreatorStats(db as never, NOW)

    // deleteMany + createMany in ONE $transaction: a reader must never see the
    // window where every creator has been un-tiered.
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.clientCreatorStat.deleteMany).toHaveBeenCalledWith({})
  })
})
