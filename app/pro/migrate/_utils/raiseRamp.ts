// app/pro/migrate/_utils/raiseRamp.ts
//
// UI presentation helpers for the price-grace calculator. The ramp math itself
// is the canonical lib/migration/priceRamp module — this file only builds the
// display schedule and formats values. Floor/clamp/step helpers are re-exported
// from the canonical module so callers keep importing them from here.

import {
  clampCadenceWeeks,
  clampStepValue,
  floorStepValue,
  nextStepPrice,
} from '@/lib/migration/priceRamp'
import { formatRoundedDollars } from '@/lib/money'
import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

import type { PriceGrace } from '../_types'

export { clampCadenceWeeks, clampStepValue, floorStepValue }

export type RampStep = {
  index: number // 1-based
  date: Date
  from: number
  to: number
}

// Step-by-step schedule from the grandfathered price up to the minimum, using
// the canonical per-step formula so the preview matches what the server applies.
export function buildRampSchedule(grace: PriceGrace, start: Date): RampStep[] {
  const min = Math.round(grace.platformMin)
  let price = Math.round(grace.grandfatheredPrice)
  if (price >= min) return []

  const steps: RampStep[] = []
  let weeks = 0
  let i = 0
  while (price < min && i < 120) {
    i += 1
    weeks += grace.cadenceWeeks
    const next = nextStepPrice(price, grace.step.mode, grace.step.value, min)
    const date = new Date(start.getTime())
    date.setDate(date.getDate() + weeks * 7)
    steps.push({ index: i, date, from: price, to: next })
    price = next
  }
  return steps
}

export function formatMoney(n: number): string {
  return formatRoundedDollars(n) ?? `$${Math.round(n)}`
}

export function formatRampDate(d: Date): string {
  return formatInTimeZone(d, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
