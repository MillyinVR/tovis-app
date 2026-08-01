// lib/booking/series/rollForwardFlag.test.ts
//
// K20 — the sweep's own kill switch.
//
// Worth its own test because it is the ONLY knob that stops the roll-forward
// without stopping the whole recurring-appointments feature, and a kill switch
// that does not switch is worse than no kill switch: it is one somebody will
// reach for in an incident and believe.
//
// Note the polarity is the opposite of `recurringAppointmentsEnabled()` — that
// one defaults OFF (a dark feature), this one defaults ON (a sweep that has to
// be deliberately silenced). Getting those two backwards is exactly the mistake
// this pins.
import { afterEach, describe, expect, it } from 'vitest'

import { seriesRollForwardEnabled } from '@/lib/booking/series/rollForwardSweep'

const ORIGINAL = process.env.SERIES_ROLL_FORWARD_ENABLED

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SERIES_ROLL_FORWARD_ENABLED
  else process.env.SERIES_ROLL_FORWARD_ENABLED = ORIGINAL
})

describe('seriesRollForwardEnabled', () => {
  it('defaults ON when unset — the sweep is inert anyway while the feature is dark', () => {
    delete process.env.SERIES_ROLL_FORWARD_ENABLED
    expect(seriesRollForwardEnabled()).toBe(true)
  })

  it.each(['0', 'false', 'FALSE', 'no', ' No '])(
    'is OFF for %j',
    (value) => {
      process.env.SERIES_ROLL_FORWARD_ENABLED = value
      expect(seriesRollForwardEnabled()).toBe(false)
    },
  )

  it.each(['1', 'true', 'yes', '', 'anything'])(
    'stays ON for %j — only an explicit off value silences it',
    (value) => {
      process.env.SERIES_ROLL_FORWARD_ENABLED = value
      expect(seriesRollForwardEnabled()).toBe(true)
    },
  )
})
