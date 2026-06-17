// lib/migration/priceRamp.test.ts

import { describe, expect, it } from 'vitest'

import {
  addWeeks,
  advanceRamp,
  buildInitialRamp,
  clampCadenceWeeks,
  clampStepValue,
  effectiveUnitPrice,
  needsRamp,
  nextStepPrice,
} from './priceRamp'

const START = new Date('2026-06-17T00:00:00.000Z')

describe('nextStepPrice', () => {
  it('applies a percent step and rounds', () => {
    expect(nextStepPrice(60, 'PCT', 10, 85)).toBe(66) // 60 * 1.1
  })
  it('applies a flat dollar step', () => {
    expect(nextStepPrice(60, 'USD', 5, 85)).toBe(65)
  })
  it('never overshoots the target', () => {
    expect(nextStepPrice(80, 'PCT', 10, 85)).toBe(85) // 88 → clamp 85
  })
  it('guarantees progress when the step is zero', () => {
    expect(nextStepPrice(60, 'USD', 0, 85)).toBe(61)
  })
  it('returns the target once at/above it', () => {
    expect(nextStepPrice(85, 'PCT', 10, 85)).toBe(85)
  })
})

describe('clamps (floor: 10% / 10 weeks)', () => {
  it('raises a too-gentle percent step to the floor', () => {
    expect(clampStepValue('PCT', 5, 60)).toBe(10)
  })
  it('raises a too-small dollar step to 10% of price', () => {
    expect(clampStepValue('USD', 1, 60)).toBe(6) // floor = round(60*0.1)
  })
  it('caps cadence at 10 weeks (slower not allowed), allows faster', () => {
    expect(clampCadenceWeeks(15)).toBe(10)
    expect(clampCadenceWeeks(4)).toBe(4)
  })
})

describe('buildInitialRamp', () => {
  it('seeds current=grandfathered, target=min, nextStep one cadence out', () => {
    const r = buildInitialRamp({
      grandfatheredPrice: 60,
      minPrice: 85,
      stepMode: 'PCT',
      stepValue: 10,
      cadenceWeeks: 10,
      startedAt: START,
    })
    expect(r.currentPrice).toBe(60)
    expect(r.targetPrice).toBe(85)
    expect(r.completedAt).toBeNull()
    expect(r.nextStepAt.getTime()).toBe(addWeeks(START, 10).getTime())
  })
  it('clamps gentler-than-floor inputs', () => {
    const r = buildInitialRamp({
      grandfatheredPrice: 60,
      minPrice: 85,
      stepMode: 'PCT',
      stepValue: 5, // below floor
      cadenceWeeks: 20, // slower than floor
      startedAt: START,
    })
    expect(r.stepValue).toBe(10)
    expect(r.cadenceWeeks).toBe(10)
  })
})

describe('advanceRamp', () => {
  const base = {
    currentPrice: 60,
    targetPrice: 85,
    stepMode: 'PCT' as const,
    stepValue: 10,
    cadenceWeeks: 10,
    nextStepAt: addWeeks(START, 10),
    completedAt: null,
  }

  it('applies every due step (catches up missed ticks)', () => {
    const now = addWeeks(START, 25) // two steps due (wk10, wk20)
    const out = advanceRamp(base, now)
    expect(out.currentPrice).toBe(73) // 60→66→73
    expect(out.completedAt).toBeNull()
    expect(out.nextStepAt.getTime()).toBe(addWeeks(START, 30).getTime())
  })

  it('completes when it reaches the target', () => {
    const out = advanceRamp(base, addWeeks(START, 300))
    expect(out.currentPrice).toBe(85)
    expect(out.completedAt).not.toBeNull()
  })

  it('is a no-op when nothing is due yet', () => {
    const out = advanceRamp(base, addWeeks(START, 3))
    expect(out.currentPrice).toBe(60)
  })

  it('leaves a completed ramp untouched', () => {
    const out = advanceRamp({ ...base, completedAt: START }, addWeeks(START, 300))
    expect(out.currentPrice).toBe(60)
    expect(out.completedAt).toEqual(START)
  })
})

describe('effectiveUnitPrice', () => {
  const ramp = { currentPrice: 66, targetPrice: 85 }
  it('charges new clients the minimum (target)', () => {
    expect(effectiveUnitPrice({ listPrice: 60, minPrice: 85, ramp, isExistingClient: false })).toBe(85)
  })
  it('charges existing clients the current ramped price', () => {
    expect(effectiveUnitPrice({ listPrice: 60, minPrice: 85, ramp, isExistingClient: true })).toBe(66)
  })
  it('with no ramp, never returns below the minimum', () => {
    expect(effectiveUnitPrice({ listPrice: 60, minPrice: 85, ramp: null, isExistingClient: true })).toBe(85)
    expect(effectiveUnitPrice({ listPrice: 120, minPrice: 85, ramp: null, isExistingClient: false })).toBe(120)
  })
})

describe('needsRamp', () => {
  it('is true only below the minimum', () => {
    expect(needsRamp(60, 85)).toBe(true)
    expect(needsRamp(85, 85)).toBe(false)
    expect(needsRamp(90, 85)).toBe(false)
  })
})
