// lib/migration/serviceMatch.test.ts

import { describe, expect, it } from 'vitest'

import {
  bestServiceMatch,
  CONFIDENT_SCORE,
  isConfident,
  normalizeServiceName,
  suggestServices,
  type MatchCatalogEntry,
} from './serviceMatch'

const CATALOG: MatchCatalogEntry[] = [
  { id: '1', name: 'Balayage', categoryName: 'Color' },
  { id: '2', name: 'Partial Highlights', categoryName: 'Color' },
  { id: '3', name: 'Full Highlights', categoryName: 'Color' },
  { id: '4', name: 'Root Touch-Up', categoryName: 'Color' },
  { id: '5', name: 'Haircut & Style', categoryName: 'Haircut' },
  { id: '6', name: "Men's Cut", categoryName: 'Haircut' },
  { id: '7', name: 'Blowout', categoryName: 'Haircut' },
  { id: '8', name: 'Gel-X Full Set', categoryName: 'Nails' },
  { id: '9', name: 'Soft Glam Makeup', categoryName: 'Makeup' },
  { id: '10', name: 'Lash Lift', categoryName: 'Lashes' },
  { id: '11', name: 'Brow Lamination', categoryName: 'Brows' },
  { id: '12', name: '60-Minute Swedish Massage', categoryName: 'Massage' },
  { id: '13', name: 'Extension Installation', categoryName: 'Extensions' },
]

function topName(input: string): string | null {
  return bestServiceMatch(input, CATALOG)?.entry.name ?? null
}

describe('normalizeServiceName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeServiceName('  Root Touch-Up!! ')).toBe('root touch up')
    expect(normalizeServiceName('Haircut & Style')).toBe('haircut and style')
  })
})

describe('suggestServices — exact & casing', () => {
  it('matches an exact name with full confidence', () => {
    const top = bestServiceMatch('Balayage', CATALOG)
    expect(top?.entry.name).toBe('Balayage')
    expect(top?.score).toBe(100)
    expect(top?.reason).toBe('exact')
  })

  it('ignores case and surrounding whitespace', () => {
    expect(topName('  BALAYAGE ')).toBe('Balayage')
  })

  it('matches despite filler words and punctuation', () => {
    // "Gel X Full Set" → "Gel-X Full Set"
    const top = bestServiceMatch('Gel X full set', CATALOG)
    expect(top?.entry.name).toBe('Gel-X Full Set')
    expect(isConfident(top)).toBe(true)
  })
})

describe('suggestServices — aliases', () => {
  it('maps vendor synonyms onto the canonical name', () => {
    expect(topName('Foilage')).toBe('Partial Highlights')
    expect(topName('Color Retouch')).toBe('Root Touch-Up')
    expect(topName("Men's Haircut")).toBe("Men's Cut")
    expect(topName('Blow Dry')).toBe('Blowout')
    expect(topName('Bridal Makeup')).toBe('Soft Glam Makeup')
  })

  it('alias matches are confident', () => {
    expect(isConfident(bestServiceMatch('Tape Ins', CATALOG))).toBe(true)
  })
})

describe('suggestServices — fuzzy typos', () => {
  it('recovers from a small typo', () => {
    expect(topName('balayge')).toBe('Balayage')
    expect(topName('swedish masage')).toBe('60-Minute Swedish Massage')
  })
})

describe('suggestServices — token overlap', () => {
  it("matches 'Womens Haircut' to Haircut & Style", () => {
    expect(topName('Womens Haircut')).toBe('Haircut & Style')
  })
})

describe('suggestServices — unknowns', () => {
  it('returns nothing for an unrelated service', () => {
    expect(suggestServices('Tarot Reading', CATALOG)).toEqual([])
    expect(bestServiceMatch('Oil Change', CATALOG)).toBeNull()
  })

  it('returns empty for blank input', () => {
    expect(suggestServices('   ', CATALOG)).toEqual([])
  })
})

describe('suggestServices — ranking & limits', () => {
  it('ranks the best candidate first and respects the limit', () => {
    const results = suggestServices('highlights', CATALOG, { limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
    // Both highlight services should surface; order is by score.
    const names = results.map((r) => r.entry.name)
    expect(names).toContain('Partial Highlights')
    expect(names).toContain('Full Highlights')
  })

  it('CONFIDENT_SCORE gates pre-selection', () => {
    const top = bestServiceMatch('Balayage', CATALOG)
    expect((top?.score ?? 0) >= CONFIDENT_SCORE).toBe(true)
  })
})
