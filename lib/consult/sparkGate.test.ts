// lib/consult/sparkGate.test.ts
//
// P7a-5 — the pure half of "may this spark be booked right now?".
//
// The rule is small on purpose: it is read by the thread's CTA and by the
// finalize boundary, and the two must not be able to disagree.

import { describe, expect, it } from 'vitest'

import { consultSparkGateBlocked } from './sparkGate'

describe('consultSparkGateBlocked', () => {
  it('never blocks a pro who has set nothing', () => {
    // A missing row is INSTANT. This is the property that makes "a pro with no
    // settings behaves exactly as today" true of the DATA rather than of a
    // branch someone has to remember to write.
    expect(consultSparkGateBlocked({ policy: null, prepComplete: false })).toBe(false)
    expect(consultSparkGateBlocked({ policy: undefined, prepComplete: false })).toBe(false)
  })

  it('never blocks a pro who chose INSTANT, even with prep outstanding', () => {
    expect(
      consultSparkGateBlocked({
        policy: { bookingGate: 'INSTANT' },
        prepComplete: false,
      }),
    ).toBe(false)
  })

  it('blocks AFTER_PREP while the safety answers are outstanding', () => {
    expect(
      consultSparkGateBlocked({
        policy: { bookingGate: 'AFTER_PREP' },
        prepComplete: false,
      }),
    ).toBe(true)
  })

  it('releases AFTER_PREP the moment prep is complete', () => {
    expect(
      consultSparkGateBlocked({
        policy: { bookingGate: 'AFTER_PREP' },
        prepComplete: true,
      }),
    ).toBe(false)
  })
})
