import { describe, expect, it } from 'vitest'

import { pickAvailableBoardSlug, slugifyBoardName } from './slug'

describe('slugifyBoardName', () => {
  it('lowercases and hyphenates a name', () => {
    expect(slugifyBoardName('Spring Hair Inspo')).toBe('spring-hair-inspo')
  })

  it('collapses non-alphanumeric runs and trims edge hyphens', () => {
    expect(slugifyBoardName('  My Board!! 2026  ')).toBe('my-board-2026')
    expect(slugifyBoardName('—balayage / blonde—')).toBe('balayage-blonde')
  })

  it('falls back to "board" when nothing survives', () => {
    expect(slugifyBoardName('!!!')).toBe('board')
    expect(slugifyBoardName('')).toBe('board')
  })

  it('matches the migration backfill regexp for accented punctuation', () => {
    // A name and a punctuated variant both slugify to the same base.
    expect(slugifyBoardName('My Board')).toBe('my-board')
    expect(slugifyBoardName('My Board!')).toBe('my-board')
  })
})

describe('pickAvailableBoardSlug', () => {
  it('returns the base when it is free', () => {
    expect(pickAvailableBoardSlug('hair', [])).toBe('hair')
    expect(pickAvailableBoardSlug('hair', ['nails', 'brows'])).toBe('hair')
  })

  it('appends the first free -N suffix on collision', () => {
    expect(pickAvailableBoardSlug('hair', ['hair'])).toBe('hair-2')
    expect(pickAvailableBoardSlug('hair', ['hair', 'hair-2'])).toBe('hair-3')
  })

  it('skips gaps but always returns an unused slug', () => {
    // hair-2 free even though hair + hair-3 taken.
    expect(pickAvailableBoardSlug('hair', ['hair', 'hair-3'])).toBe('hair-2')
  })
})
