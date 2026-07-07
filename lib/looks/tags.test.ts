// lib/looks/tags.test.ts
import { describe, expect, it } from 'vitest'

import { MAX_LOOK_TAGS, parseLookTags, slugifyLookTag } from './tags'

describe('parseLookTags', () => {
  it('extracts, normalizes, dedupes by slug, and preserves first-seen display', () => {
    const tags = parseLookTags('Loving this #Balayage #balayage #90sBlowout #Balayage')
    expect(tags).toEqual([
      { slug: 'balayage', display: 'Balayage' },
      { slug: '90sblowout', display: '90sBlowout' },
    ])
  })

  it('ignores a lone # and single-char tokens', () => {
    expect(parseLookTags('# #a just vibes')).toEqual([])
  })

  it('returns [] for null / empty captions', () => {
    expect(parseLookTags(null)).toEqual([])
    expect(parseLookTags('')).toEqual([])
  })

  it('caps at MAX_LOOK_TAGS', () => {
    const caption = Array.from({ length: 20 }, (_, i) => `#tag${i}`).join(' ')
    expect(parseLookTags(caption)).toHaveLength(MAX_LOOK_TAGS)
  })
})

describe('slugifyLookTag', () => {
  it('lowercases and strips non-ascii-alphanumerics', () => {
    expect(slugifyLookTag('Baby_Lights')).toBe('babylights')
    expect(slugifyLookTag('90sBlowout')).toBe('90sblowout')
  })
})
