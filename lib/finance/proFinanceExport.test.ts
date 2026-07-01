import { describe, expect, it } from 'vitest'

import {
  isFinanceExportScope,
  monthKeysForScope,
} from './proFinanceExport'

describe('isFinanceExportScope', () => {
  it('accepts the three known scopes and rejects others', () => {
    expect(isFinanceExportScope('month')).toBe(true)
    expect(isFinanceExportScope('ytd')).toBe(true)
    expect(isFinanceExportScope('year')).toBe(true)
    expect(isFinanceExportScope('quarter')).toBe(false)
    expect(isFinanceExportScope('')).toBe(false)
  })
})

describe('monthKeysForScope', () => {
  it('month → just the selected month', () => {
    expect(monthKeysForScope('month', '2026-06')).toEqual(['2026-06'])
  })

  it('ytd → January through the selected month (inclusive)', () => {
    expect(monthKeysForScope('ytd', '2026-04')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ])
  })

  it('year → all 12 months of the selected year', () => {
    const keys = monthKeysForScope('year', '2026-06')
    expect(keys).toHaveLength(12)
    expect(keys[0]).toBe('2026-01')
    expect(keys.at(-1)).toBe('2026-12')
  })
})
