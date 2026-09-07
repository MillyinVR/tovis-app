import { describe, expect, it } from 'vitest'
import { marketingPricing } from './marketingPricing'

describe('public pricing follows the charging rollout', () => {
  it('does not advertise discovery charges while charging is disabled', () => {
    const copy = marketingPricing(false)
    expect(copy.professional).toContain('not currently being charged')
    expect(copy.client).toContain('not currently being charged')
    expect(copy.commission).toContain('processing is separate')
  })
  it('distinguishes the two payers and bases the client fee on the deposit', () => {
    const copy = marketingPricing(true)
    expect(copy.professional).toContain('$5')
    expect(copy.professional).toContain('capped at the deposit')
    expect(copy.client).toContain('10% of the deposit')
    expect(copy.client).toContain('$2 minimum and $10 maximum')
    expect(copy.scope).toContain('refunded')
  })
})
