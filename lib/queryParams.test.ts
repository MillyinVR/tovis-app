import { describe, expect, it } from 'vitest'
import {
  clampFloat,
  parseCommaIds,
  parseFloatParam,
  parseIntParam,
  toIntParam,
} from './queryParams'

describe('clampFloat', () => {
  it('clamps into range and returns min for non-finite', () => {
    expect(clampFloat(5, 0, 10)).toBe(5)
    expect(clampFloat(-1, 0, 10)).toBe(0)
    expect(clampFloat(99, 0, 10)).toBe(10)
    expect(clampFloat(Number.NaN, 2, 10)).toBe(2)
  })
})

describe('parseFloatParam', () => {
  it('parses finite floats, else null', () => {
    expect(parseFloatParam('3.5')).toBe(3.5)
    expect(parseFloatParam(null)).toBeNull()
    expect(parseFloatParam('')).toBeNull()
    expect(parseFloatParam('abc')).toBeNull()
  })
})

describe('parseIntParam', () => {
  it('truncates finite numbers, else null', () => {
    expect(parseIntParam('3.9')).toBe(3)
    expect(parseIntParam(null)).toBeNull()
    expect(parseIntParam('x')).toBeNull()
  })
})

describe('parseCommaIds', () => {
  it('splits, trims, drops blanks, caps at max', () => {
    expect(parseCommaIds('a, b ,,c')).toEqual(['a', 'b', 'c'])
    expect(parseCommaIds(null)).toEqual([])
    expect(parseCommaIds('a,b,c', 2)).toEqual(['a', 'b'])
  })
})

describe('toIntParam', () => {
  it('truncates or falls back on non-finite', () => {
    expect(toIntParam('7.8', 1)).toBe(7)
    expect(toIntParam('nope', 5)).toBe(5)
    // Preserved legacy behavior: Number(null) === 0, so absent params coerce to 0
    // (not the fallback). Matches the local toInt helpers this replaces.
    expect(toIntParam(null, 1)).toBe(0)
  })
})
