import { describe, expect, it } from 'vitest'
import { RESERVED_HANDLES, isHandleReserved } from './handles'

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
})