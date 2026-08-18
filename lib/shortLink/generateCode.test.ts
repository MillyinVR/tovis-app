// lib/shortLink/generateCode.test.ts

import { describe, expect, it } from 'vitest'

import {
  generateShortLinkCode,
  normalizeShortLinkCode,
  SHORT_LINK_CODE_LENGTH,
} from './generateCode'

describe('generateShortLinkCode', () => {
  it('defaults to 8 base62 characters', () => {
    const code = generateShortLinkCode()
    expect(code).toHaveLength(SHORT_LINK_CODE_LENGTH)
    expect(code).toMatch(/^[0-9A-Za-z]{8}$/)
  })

  it('honors an explicit length', () => {
    expect(generateShortLinkCode(12)).toHaveLength(12)
  })

  it('produces distinct codes across many draws', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateShortLinkCode()))
    // 62^8 possibilities — 500 draws colliding would indicate a broken RNG.
    expect(codes.size).toBe(500)
  })
})

describe('normalizeShortLinkCode', () => {
  it('accepts a well-formed code', () => {
    expect(normalizeShortLinkCode('Ab3xK9pQ')).toBe('Ab3xK9pQ')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeShortLinkCode('  Ab3xK9pQ  ')).toBe('Ab3xK9pQ')
  })

  it('preserves case (codes are tapped, not hand-typed)', () => {
    expect(normalizeShortLinkCode('abcXYZ12')).toBe('abcXYZ12')
  })

  it.each([
    ['non-string input', 123],
    ['null', null],
    ['undefined', undefined],
    ['too short', 'abc123'],
    ['too long', 'a'.repeat(17)],
    ['contains a slash', 'ab3xK9p/'],
    ['contains a space', 'ab3xK9 p'],
    ['contains punctuation', 'ab3xK9p!'],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeShortLinkCode(raw)).toBeNull()
  })
})
