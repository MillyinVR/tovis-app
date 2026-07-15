import { describe, expect, it } from 'vitest'

import { LOOK_CATEGORY_TREND } from '@/lib/looks/categoryTrendStats'

import {
  buildShotPacksEtag,
  loadCameraShotPacks,
  type ShotPacksPayload,
} from './cameraShotPacks'

type TrendRow = {
  categorySlug: string
  weightedEngagement: number
  impressions: number
}

// A minimal reader stand-in for the trend table (the structural type
// CategoryTrendStatReader expects). No DB — just the rows the test wants ranked.
function dbWith(rows: TrendRow[]) {
  return {
    lookCategoryTrendStat: {
      findMany: async () => rows,
    },
  }
}

const emptyDb = dbWith([])
const min = LOOK_CATEGORY_TREND.minImpressions

describe('loadCameraShotPacks', () => {
  it('returns versioned packs sorted hottest-first', async () => {
    const { version, packs } = await loadCameraShotPacks(emptyDb)
    expect(version).toBeGreaterThan(0)
    expect(packs.length).toBeGreaterThan(0)
    const scores = packs.map((pack) => pack.trendScore)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('falls back to the editorial order when there is no trend data', async () => {
    const { packs } = await loadCameraShotPacks(emptyDb)
    // The pre-C10 editorial base ordering + scores, byte-identical.
    expect(packs.map((p) => p.id)).toEqual([
      'hair-reveal-v1',
      'over-shoulder-glance-v1',
      'nails-claw-sparkle-v1',
      'makeup-golden-glow-v1',
    ])
    expect(packs.map((p) => p.trendScore)).toEqual([100, 90, 85, 80])
  })

  it('survives a trend-read failure by serving the editorial order', async () => {
    const brokenDb = {
      lookCategoryTrendStat: {
        findMany: async () => {
          throw new Error('db down')
        },
      },
    }
    const { packs } = await loadCameraShotPacks(brokenDb)
    expect(packs.map((p) => p.id)[0]).toBe('hair-reveal-v1')
    expect(packs.map((p) => p.trendScore)).toEqual([100, 90, 85, 80])
  })

  it('lets a red-hot family reorder packs above the editorial leaders', async () => {
    // Nails hottest evidenced family (rate 0.4); hair a quarter as hot (rate 0.1).
    const { packs } = await loadCameraShotPacks(
      dbWith([
        { categorySlug: 'nails', weightedEngagement: 0.4 * min * 2, impressions: min * 2 },
        { categorySlug: 'hair', weightedEngagement: 0.1 * min * 2, impressions: min * 2 },
      ]),
    )

    // Claw & Sparkle (nails, base 85) gets the full +30 lift → 115, jumping the
    // editorial leader The Reveal (hair, base 100).
    expect(packs[0]?.id).toBe('nails-claw-sparkle-v1')
    expect(packs[0]?.trendScore).toBe(115)
    expect(packs[1]?.id).toBe('hair-reveal-v1')
    expect(packs[1]?.trendScore).toBeGreaterThan(100)
  })

  it('always serves integer trendScores (the iOS decoder types them as Int)', async () => {
    const { packs } = await loadCameraShotPacks(
      dbWith([
        // A rate that produces a fractional raw lift, to prove rounding.
        { categorySlug: 'hair', weightedEngagement: 0.17 * min * 2, impressions: min * 2 },
      ]),
    )
    for (const pack of packs) {
      expect(Number.isInteger(pack.trendScore)).toBe(true)
    }
  })

  it('every pack and step is well-formed', async () => {
    const { packs } = await loadCameraShotPacks(emptyDb)
    const ids = new Set<string>()
    for (const pack of packs) {
      expect(ids.has(pack.id)).toBe(false)
      ids.add(pack.id)
      expect(pack.name.length).toBeGreaterThan(0)
      expect(pack.serviceKeywords.length).toBeGreaterThan(0)
      // Keywords are matched lowercased client-side — keep them lowercase here.
      for (const keyword of pack.serviceKeywords) {
        expect(keyword).toBe(keyword.toLowerCase())
      }
      expect(pack.steps.length).toBeGreaterThan(0)
      for (const step of pack.steps) {
        expect(step.title.length).toBeGreaterThan(0)
        expect(step.hint.length).toBeGreaterThan(0)
        expect(step.icon.length).toBeGreaterThan(0)
        // Fill band is both-or-neither, ordered, within 0…1.
        expect(step.fillBandMin === null).toBe(step.fillBandMax === null)
        if (step.fillBandMin !== null && step.fillBandMax !== null) {
          expect(step.fillBandMin).toBeLessThan(step.fillBandMax)
          expect(step.fillBandMin).toBeGreaterThanOrEqual(0)
          expect(step.fillBandMax).toBeLessThanOrEqual(1)
        }
        for (const rule of step.pose) {
          expect(rule.tip.length).toBeGreaterThan(0)
        }
      }
      // Step titles are the client's step ids — must be unique within a pack.
      const titles = pack.steps.map((step) => step.title)
      expect(new Set(titles).size).toBe(titles.length)
    }
  })
})

describe('buildShotPacksEtag', () => {
  const packA: ShotPacksPayload['packs'][number] = {
    id: 'a',
    name: 'A',
    tagline: '',
    serviceKeywords: ['x'],
    trendScore: 100,
    steps: [],
  }
  const packB: ShotPacksPayload['packs'][number] = {
    id: 'b',
    name: 'B',
    tagline: '',
    serviceKeywords: ['y'],
    trendScore: 90,
    steps: [],
  }
  const payload: ShotPacksPayload = { version: 1, packs: [packA, packB] }

  it('is a weak, version-prefixed ETag', () => {
    const etag = buildShotPacksEtag(payload)
    expect(etag.startsWith('W/"shot-packs-1-')).toBe(true)
    expect(etag.endsWith('"')).toBe(true)
  })

  it('is deterministic for an identical payload', () => {
    expect(buildShotPacksEtag(payload)).toBe(buildShotPacksEtag(payload))
  })

  it('changes when the ordering or a score changes', () => {
    const reordered: ShotPacksPayload = { version: 1, packs: [packB, packA] }
    const rescored: ShotPacksPayload = {
      version: 1,
      packs: [{ ...packA, trendScore: 115 }, packB],
    }
    expect(buildShotPacksEtag(reordered)).not.toBe(buildShotPacksEtag(payload))
    expect(buildShotPacksEtag(rescored)).not.toBe(buildShotPacksEtag(payload))
  })
})
