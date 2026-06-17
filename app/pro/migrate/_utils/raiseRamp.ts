// app/pro/migrate/_utils/raiseRamp.ts
//
// Pure presentation math for the price-grace raise ramp. The real enforcement lives
// server-side at booking quote time (deferred); this drives the live calculator only.

import { RAISE_FLOOR_PCT, RAISE_FLOOR_WEEKS } from '../_constants'
import type { PriceGrace, RaiseStepMode } from '../_types'

export type RampStep = {
  index: number // 1-based
  date: Date
  from: number
  to: number
}

// The smallest step allowed by the floor, given the mode + current price.
export function floorStepValue(mode: RaiseStepMode, currentPrice: number): number {
  return mode === 'PCT'
    ? RAISE_FLOOR_PCT
    : Math.max(1, Math.round((currentPrice * RAISE_FLOOR_PCT) / 100))
}

// Clamp a pro-chosen step so it's never gentler than the floor (faster is fine).
export function clampStepValue(
  mode: RaiseStepMode,
  value: number,
  currentPrice: number,
): number {
  return Math.max(floorStepValue(mode, currentPrice), Math.round(value))
}

// Clamp cadence so it's never slower than the floor (fewer weeks = faster = allowed).
export function clampCadenceWeeks(weeks: number): number {
  return Math.min(RAISE_FLOOR_WEEKS, Math.max(1, Math.round(weeks)))
}

// Build the step-by-step schedule from the grandfathered price up to the minimum.
export function buildRampSchedule(grace: PriceGrace, start: Date): RampStep[] {
  const min = Math.round(grace.platformMin)
  let price = Math.round(grace.grandfatheredPrice)
  if (price >= min) return []

  const steps: RampStep[] = []
  let weeks = 0
  let i = 0
  // guard against pathological inputs (e.g. value 0)
  while (price < min && i < 120) {
    i += 1
    weeks += grace.cadenceWeeks
    let next =
      grace.step.mode === 'PCT'
        ? Math.round(price * (1 + grace.step.value / 100))
        : price + grace.step.value
    if (next <= price) next = price + 1
    if (next >= min) next = min
    const date = new Date(start.getTime())
    date.setDate(date.getDate() + weeks * 7)
    steps.push({ index: i, date, from: price, to: next })
    price = next
  }
  return steps
}

export function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export function formatRampDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
