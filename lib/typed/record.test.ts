import { describe, expect, it } from 'vitest'
import { toRecord } from './record'

describe('toRecord', () => {
  it('returns the same object widened to Record<string, unknown>', () => {
    const value = { availableDays: ['2026-06-10'], selectedDay: null }
    const record = toRecord(value)

    expect(record).toBe(value)
    expect(record.selectedDay).toBeNull()
  })

  it('rejects arrays', () => {
    expect(() => toRecord([1, 2, 3])).toThrow(/non-array/)
  })
})
