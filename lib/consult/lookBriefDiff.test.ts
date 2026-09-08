import { describe, expect, it } from 'vitest'
import { describeLookExpectationChanges } from './lookBriefDiff'
import type { ConsultLookAdjustment } from './lookAdjustments'

const note = (value: string): ConsultLookAdjustment => ({ field: 'EXPECTATIONS', pathIndex: 0,
  visitIndex: null, offeringId: null, locationType: null, value, reason: null, professionalId: 'pro' })
describe('shared expectation changes', () => {
  it('shows the actual result clarification instead of menu names', () => {
    expect(describeLookExpectationChanges([note('Platinum')], [note('Buttery blonde')]))
      .toEqual(['Option 1: expected result changed from “Platinum” to “Buttery blonde”.'])
  })
  it('does not repeat unchanged notes on price or time edits', () => {
    expect(describeLookExpectationChanges([note('Keep natural roots')], [note('Keep natural roots')])).toEqual([])
  })
})
