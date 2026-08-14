// lib/booking/daySupply.test.ts
import { describe, expect, it } from 'vitest'

import { daySupplyIsScarce, daySupplyLabel } from './daySupply'

describe('daySupplyLabel', () => {
  it('reads as scarcity only when it is', () => {
    expect(daySupplyLabel(6)).toBe('6 open')
    expect(daySupplyLabel(3)).toBe('3 open')
    expect(daySupplyLabel(2)).toBe('2 left')
    expect(daySupplyLabel(1)).toBe('1 left')
  })

  it('never renders a day with nothing left as an opening', () => {
    expect(daySupplyLabel(0)).toBe('Full')
    expect(daySupplyLabel(-1)).toBe('Full')
    expect(daySupplyLabel(Number.NaN)).toBe('Full')
  })
})

describe('daySupplyIsScarce', () => {
  it('marks only the last couple of starts', () => {
    expect(daySupplyIsScarce(3)).toBe(false)
    expect(daySupplyIsScarce(2)).toBe(true)
    expect(daySupplyIsScarce(1)).toBe(true)
  })

  it('a day with nothing left is gone, not scarce', () => {
    expect(daySupplyIsScarce(0)).toBe(false)
    expect(daySupplyIsScarce(Number.NaN)).toBe(false)
  })
})
