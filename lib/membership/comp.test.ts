// lib/membership/comp.test.ts — pure pieces of the admin comp machinery.
import { describe, expect, it } from 'vitest'

import {
  COMP_MAX_MONTHS,
  addUtcMonths,
  parseCompMonths,
  parseCompPlanKey,
} from '@/lib/membership/comp'

describe('parseCompPlanKey', () => {
  it('accepts the paid tiers (case/whitespace tolerant), never free', () => {
    expect(parseCompPlanKey('pro')).toBe('pro')
    expect(parseCompPlanKey(' Premium ')).toBe('premium')
    expect(parseCompPlanKey('STUDIO')).toBe('studio')
    expect(parseCompPlanKey('free')).toBeNull()
    expect(parseCompPlanKey('bogus')).toBeNull()
    expect(parseCompPlanKey(42)).toBeNull()
    expect(parseCompPlanKey(undefined)).toBeNull()
  })
})

describe('parseCompMonths', () => {
  it('accepts whole months within bounds only', () => {
    expect(parseCompMonths(1)).toBe(1)
    expect(parseCompMonths('6')).toBe(6)
    expect(parseCompMonths(COMP_MAX_MONTHS)).toBe(COMP_MAX_MONTHS)
    expect(parseCompMonths(0)).toBeNull()
    expect(parseCompMonths(COMP_MAX_MONTHS + 1)).toBeNull()
    expect(parseCompMonths(1.5)).toBeNull()
    expect(parseCompMonths('soon')).toBeNull()
  })
})

describe('addUtcMonths', () => {
  it('adds calendar months in UTC', () => {
    expect(
      addUtcMonths(new Date('2026-07-03T12:00:00Z'), 3).toISOString(),
    ).toBe('2026-10-03T12:00:00.000Z')
    expect(
      addUtcMonths(new Date('2026-11-15T00:00:00Z'), 2).toISOString(),
    ).toBe('2027-01-15T00:00:00.000Z')
  })

  it('rolls month-end overflow forward (documented, slightly generous)', () => {
    // Jan 31 + 1 month → Mar 3 (2026 is not a leap year: Feb has 28 days).
    expect(
      addUtcMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString(),
    ).toBe('2026-03-03T00:00:00.000Z')
  })
})
