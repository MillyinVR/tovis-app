import { describe, expect, it } from 'vitest'

import {
  EXPENSE_CATEGORIES,
  resolveExpenseCategories,
} from './expenseCategories'
import {
  computeEstimatedTaxCents,
  computeIncomeTotalCents,
  expenseDateFields,
  nextQuarterlyDueLabel,
} from './proFinanceSummary'

describe('computeIncomeTotalCents', () => {
  it('sums services + tips + products (tips are NOT in revenueTotal)', () => {
    // Matches the design mock: $3,840 services + $620 tips + $180 products.
    expect(
      computeIncomeTotalCents({
        serviceRevenueCents: 384000,
        productRevenueCents: 18000,
        tipCents: 62000,
      }),
    ).toBe(464000)
  })

  it('is zero for an empty month', () => {
    expect(
      computeIncomeTotalCents({
        serviceRevenueCents: 0,
        productRevenueCents: 0,
        tipCents: 0,
      }),
    ).toBe(0)
  })
})

describe('computeEstimatedTaxCents', () => {
  it('applies the ~28% rate and rounds (matches the mock $1,030.01)', () => {
    expect(computeEstimatedTaxCents(367860)).toBe(103001)
  })

  it('never estimates tax on a loss', () => {
    expect(computeEstimatedTaxCents(0)).toBe(0)
    expect(computeEstimatedTaxCents(-5000)).toBe(0)
  })
})

describe('nextQuarterlyDueLabel', () => {
  it('picks the next statutory due date strictly after now', () => {
    expect(
      nextQuarterlyDueLabel({
        now: new Date('2026-06-01T12:00:00Z'),
        timeZone: 'America/Los_Angeles',
      }),
    ).toBe('June 15, 2026')

    expect(
      nextQuarterlyDueLabel({
        now: new Date('2026-06-20T12:00:00Z'),
        timeZone: 'America/Los_Angeles',
      }),
    ).toBe('September 15, 2026')
  })

  it('rolls into next January when past the September deadline', () => {
    expect(
      nextQuarterlyDueLabel({
        now: new Date('2026-12-01T12:00:00Z'),
        timeZone: 'America/Los_Angeles',
      }),
    ).toBe('January 15, 2027')
  })
})

describe('expenseDateFields', () => {
  it('anchors spentAt to start-of-day in the pro timezone and freezes monthKey', () => {
    const { spentAt, monthKey } = expenseDateFields({
      dateInput: { year: 2026, month: 4, day: 3 },
      timeZone: 'America/Los_Angeles',
    })

    // Midnight Apr 3 in LA (PDT, UTC-7) === 07:00 UTC.
    expect(spentAt.toISOString()).toBe('2026-04-03T07:00:00.000Z')
    expect(monthKey).toBe('2026-04')
  })

  it('falls back to the default timezone for a bad zone', () => {
    const { monthKey } = expenseDateFields({
      dateInput: { year: 2026, month: 12, day: 31 },
      timeZone: 'Not/AZone',
    })
    expect(monthKey).toBe('2026-12')
  })
})

describe('resolveExpenseCategories', () => {
  it('fills the {brand} and {mileageRate} tokens and leaves none behind', () => {
    const resolved = resolveExpenseCategories({ brandName: 'TOVIS' })

    const software = resolved.find((c) => c.id === 'SOFTWARE_APPS')
    expect(software?.tooltip).toContain('TOVIS')
    expect(software?.examples).toContain('TOVIS subscription')

    const mileage = resolved.find((c) => c.id === 'MILEAGE')
    expect(mileage?.tooltip).toContain('72.5¢/mi')

    for (const category of resolved) {
      expect(category.tooltip).not.toContain('{brand}')
      expect(category.tooltip).not.toContain('{mileageRate}')
      for (const example of category.examples) {
        expect(example).not.toContain('{brand}')
      }
    }
  })

  it('exposes exactly the 11 spec categories with a risk level each', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(11)
    for (const category of EXPENSE_CATEGORIES) {
      expect(['green', 'yellow', 'red']).toContain(category.risk)
    }
  })
})
