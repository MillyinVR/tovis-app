// lib/geo/distance.test.ts
import { describe, expect, it } from 'vitest'

import { haversineMiles } from '@/lib/geo/distance'

describe('haversineMiles', () => {
  it('returns zero distance for identical coordinates', () => {
    expect(
      haversineMiles(
        { lat: 32.7157, lng: -117.1611 },
        { lat: 32.7157, lng: -117.1611 },
      ),
    ).toBeCloseTo(0, 8)
  })

  it('returns a positive symmetric distance for different coordinates', () => {
    const a = { lat: 32.7157, lng: -117.1611 }
    const b = { lat: 34.0522, lng: -118.2437 }

    const ab = haversineMiles(a, b)
    const ba = haversineMiles(b, a)

    expect(ab).toBeGreaterThan(0)
    expect(ab).toBeCloseTo(ba, 8)
  })

  // The three forks this module replaced all carried 3958.7613. The suites that
  // consumed them asserted only ordering and symmetry, so a wrong radius — or a
  // kilometres/miles mix-up — would have passed every one of them. These two pin
  // the SCALE, which is the part nothing else checks.
  it('measures San Diego → Los Angeles at the real ~111 miles', () => {
    const miles = haversineMiles(
      { lat: 32.7157, lng: -117.1611 },
      { lat: 34.0522, lng: -118.2437 },
    )

    expect(miles).toBeGreaterThan(109)
    expect(miles).toBeLessThan(113)
  })

  it('measures one degree of latitude at ~69 miles', () => {
    const miles = haversineMiles({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })

    expect(miles).toBeCloseTo(69.09, 1)
  })

  // The `Math.min(1, …)` clamp: without it, floating-point drift just above
  // unity makes `Math.asin` return NaN for two antipodal-ish or identical
  // points. A NaN here would sail through the radius gate's `>` comparison.
  it('never returns NaN, including at the antipode', () => {
    expect(haversineMiles({ lat: 90, lng: 0 }, { lat: -90, lng: 0 })).toBeGreaterThan(0)
    expect(
      Number.isNaN(haversineMiles({ lat: 90, lng: 0 }, { lat: -90, lng: 180 })),
    ).toBe(false)
  })
})
