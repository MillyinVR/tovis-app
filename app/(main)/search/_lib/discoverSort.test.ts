// app/(main)/search/_lib/discoverSort.test.ts
import { describe, expect, it } from 'vitest'

import type { ApiPro } from './discoverProTypes'
import { isSortMode, sortPros, type SortMode } from './discoverSort'

function pro(overrides: Partial<ApiPro> & { id: string }): ApiPro {
  return {
    businessName: null,
    displayName: overrides.id,
    handle: null,
    professionType: null,
    avatarUrl: null,
    locationLabel: null,
    distanceMiles: null,
    ratingAvg: null,
    ratingCount: 0,
    minPrice: null,
    supportsMobile: false,
    closestLocation: null,
    primaryLocation: null,
    ...overrides,
  }
}

const ids = (list: ApiPro[]) => list.map((p) => p.id)

describe('isSortMode', () => {
  it('accepts every dropdown value, including PRICE', () => {
    for (const value of ['DISTANCE', 'NAME', 'RATING', 'PRICE'] satisfies SortMode[]) {
      expect(isSortMode(value)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isSortMode('price')).toBe(false) // case-sensitive; the <option> emits uppercase
    expect(isSortMode('')).toBe(false)
    expect(isSortMode('CHAOS')).toBe(false)
  })
})

describe('sortPros — PRICE', () => {
  it('orders cheapest first', () => {
    const list = [
      pro({ id: 'mid', minPrice: 85 }),
      pro({ id: 'cheap', minPrice: 50 }),
      pro({ id: 'dear', minPrice: 120 }),
    ]
    expect(ids(sortPros(list, 'PRICE'))).toEqual(['cheap', 'mid', 'dear'])
  })

  it('sends pros without a price to the end (NULLS LAST parity)', () => {
    const list = [
      pro({ id: 'noprice', minPrice: null }),
      pro({ id: 'dear', minPrice: 120 }),
      pro({ id: 'cheap', minPrice: 50 }),
    ]
    expect(ids(sortPros(list, 'PRICE'))).toEqual(['cheap', 'dear', 'noprice'])
  })

  it('is stable for equal prices — preserves the server tie-break order', () => {
    const list = [
      pro({ id: 'first', minPrice: 60 }),
      pro({ id: 'second', minPrice: 60 }),
      pro({ id: 'third', minPrice: 60 }),
    ]
    expect(ids(sortPros(list, 'PRICE'))).toEqual(['first', 'second', 'third'])
  })

  it('does not mutate the input list', () => {
    const list = [pro({ id: 'b', minPrice: 90 }), pro({ id: 'a', minPrice: 40 })]
    sortPros(list, 'PRICE')
    expect(ids(list)).toEqual(['b', 'a'])
  })
})

describe('sortPros — other modes still hold', () => {
  it('DISTANCE: nearest first, missing distance last', () => {
    const list = [
      pro({ id: 'far', distanceMiles: 9 }),
      pro({ id: 'none', distanceMiles: null }),
      pro({ id: 'near', distanceMiles: 1 }),
    ]
    expect(ids(sortPros(list, 'DISTANCE'))).toEqual(['near', 'far', 'none'])
  })

  it('RATING: highest rating first, then rating count', () => {
    const list = [
      pro({ id: 'lo', ratingAvg: 4.0, ratingCount: 100 }),
      pro({ id: 'hi', ratingAvg: 4.8, ratingCount: 2 }),
      pro({ id: 'hi-more', ratingAvg: 4.8, ratingCount: 40 }),
    ]
    expect(ids(sortPros(list, 'RATING'))).toEqual(['hi-more', 'hi', 'lo'])
  })

  it('NAME: alphabetical by business name', () => {
    const list = [
      pro({ id: 'z', businessName: 'Zed Studio' }),
      pro({ id: 'a', businessName: 'Ada Salon' }),
    ]
    expect(ids(sortPros(list, 'NAME'))).toEqual(['a', 'z'])
  })
})
