import { describe, expect, it } from 'vitest'

import { loadCameraShotPacks } from './cameraShotPacks'

describe('loadCameraShotPacks', () => {
  it('returns versioned packs sorted hottest-first', () => {
    const { version, packs } = loadCameraShotPacks()
    expect(version).toBeGreaterThan(0)
    expect(packs.length).toBeGreaterThan(0)
    const scores = packs.map((pack) => pack.trendScore)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('every pack and step is well-formed', () => {
    const { packs } = loadCameraShotPacks()
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
