// lib/initials.test.ts
import { describe, expect, it } from 'vitest'

import { initialsForName } from '@/lib/initials'

describe('initialsForName', () => {
  it('uses the first and last word for multi-word names', () => {
    expect(initialsForName('Jane Doe')).toBe('JD')
    expect(initialsForName('Jane Anne Doe')).toBe('JD')
    expect(initialsForName('glow studio')).toBe('GS')
  })

  it('uses a single letter for single-word names', () => {
    expect(initialsForName('Sasha')).toBe('S')
    expect(initialsForName('glow')).toBe('G')
  })

  it('collapses and ignores surrounding whitespace', () => {
    expect(initialsForName('   Jane    Doe   ')).toBe('JD')
  })

  it('returns the fallback for blank input (defaults to "P")', () => {
    expect(initialsForName('')).toBe('P')
    expect(initialsForName('   ')).toBe('P')
    expect(initialsForName('', '?')).toBe('?')
  })
})
