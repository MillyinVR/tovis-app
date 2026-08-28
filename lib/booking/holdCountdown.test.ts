// lib/booking/holdCountdown.test.ts
import { describe, expect, it } from 'vitest'

import {
  HOLD_COUNTDOWN_URGENT_MS,
  formatHoldCountdown,
  isHoldCountdownUrgent,
} from './holdCountdown'

describe('formatHoldCountdown', () => {
  it('pads both halves so the label never changes width mid-tick', () => {
    expect(formatHoldCountdown(9 * 60_000)).toBe('09:00')
    expect(formatHoldCountdown(61_000)).toBe('01:01')
    expect(formatHoldCountdown(9_000)).toBe('00:09')
  })

  it('floors rather than rounds — a hold with 0.9s left has not got a second', () => {
    expect(formatHoldCountdown(1_900)).toBe('00:01')
    expect(formatHoldCountdown(999)).toBe('00:00')
  })

  it('clamps a lapsed hold at 00:00 instead of counting into the negative', () => {
    expect(formatHoldCountdown(0)).toBe('00:00')
    expect(formatHoldCountdown(-60_000)).toBe('00:00')
  })

  it('reads 00:00 for a value that is not a number at all', () => {
    // An unparseable `expiresAt` yields NaN upstream; a tile saying "NaN:NaN"
    // is worse than one saying the time is up.
    expect(formatHoldCountdown(Number.NaN)).toBe('00:00')
    expect(formatHoldCountdown(Number.POSITIVE_INFINITY)).toBe('00:00')
  })
})

describe('isHoldCountdownUrgent', () => {
  it('turns on inside the threshold and stays off at or past zero', () => {
    expect(isHoldCountdownUrgent(HOLD_COUNTDOWN_URGENT_MS)).toBe(true)
    expect(isHoldCountdownUrgent(HOLD_COUNTDOWN_URGENT_MS + 1)).toBe(false)
    expect(isHoldCountdownUrgent(1)).toBe(true)

    // Already lapsed is not "urgent" — it is over, and the surfaces that read
    // this switch to their expired branch instead.
    expect(isHoldCountdownUrgent(0)).toBe(false)
    expect(isHoldCountdownUrgent(-1)).toBe(false)
    expect(isHoldCountdownUrgent(Number.NaN)).toBe(false)
  })
})
