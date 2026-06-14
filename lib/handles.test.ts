import { describe, expect, it } from 'vitest'
import {
  HANDLE_MAX,
  RESERVED_HANDLES,
  isHandleReserved,
  isValidHandle,
  normalizeHandle,
  sanitizeHandleInput,
} from './handles'

function normalizeForTest(value: string): string {
  return value.trim().toLowerCase()
}

describe('lib/handles.ts', () => {
  it('returns true for an exact reserved handle', () => {
    expect(RESERVED_HANDLES.has('admin')).toBe(true)
    expect(isHandleReserved('admin')).toBe(true)
  })

  it('returns true for a mixed-case reserved handle after normalization', () => {
    expect(isHandleReserved(normalizeForTest('Admin'))).toBe(true)
    expect(isHandleReserved(normalizeForTest('TOVIS'))).toBe(true)
  })

  it('returns false for a non-reserved handle', () => {
    expect(isHandleReserved(normalizeForTest('jane_smith'))).toBe(false)
  })

  it('does not reject a non-reserved handle just because it contains a reserved substring', () => {
    expect(isHandleReserved(normalizeForTest('admin_jane'))).toBe(false)
  })

  describe('normalizeHandle', () => {
    it('trims and lowercases without stripping characters', () => {
      expect(normalizeHandle('  Jane-Smith  ')).toBe('jane-smith')
    })

    it('preserves hyphens (canonical charset) and leaves invalid chars for isValidHandle to reject', () => {
      expect(normalizeHandle('Jane_Smith')).toBe('jane_smith')
    })
  })

  describe('isValidHandle', () => {
    it('accepts a canonical hyphenated handle', () => {
      expect(isValidHandle('jane-smith')).toBe(true)
    })

    it('rejects underscores, too-short, and edge-hyphen handles', () => {
      expect(isValidHandle('jane_smith')).toBe(false)
      expect(isValidHandle('ab')).toBe(false)
      expect(isValidHandle('-jane')).toBe(false)
      expect(isValidHandle('jane-')).toBe(false)
    })
  })

  describe('sanitizeHandleInput', () => {
    it('lowercases, drops non-charset chars, and trims edge hyphens', () => {
      expect(sanitizeHandleInput('  Jane Smith! ')).toBe('janesmith')
      expect(sanitizeHandleInput('Jane_Smith')).toBe('janesmith')
      expect(sanitizeHandleInput('--jane--smith--')).toBe('jane--smith')
    })

    it('caps length at HANDLE_MAX', () => {
      expect(sanitizeHandleInput('a'.repeat(50))).toHaveLength(HANDLE_MAX)
    })
  })
})