// lib/booking/rebookWidth.test.ts
//
// The OFFER side of the aftercare rebook width. This module had no test of its
// own, which mattered the moment 0 became a legal add-on duration: a
// priced-but-timeless retail add-on used to be impossible to persist, so the
// "snapshot-less item counts as 60" fallback could only ever fire on corrupt
// data. Once `resolveAddOnDurationMinutes` started returning a real 0, that
// same fallback would have silently widened every rebook of such a booking by
// a full hour — and because this function is ALSO what the commit sizes with,
// the offer and the commit would have been wrong together, which no
// offer-vs-commit assertion would have caught.

import { describe, expect, it } from 'vitest'

import { computeRebookCloneDurationMinutes } from './rebookWidth'

function source(
  durations: Array<number | null>,
  totalDurationMinutes: number | null = null,
) {
  return {
    totalDurationMinutes,
    serviceItems: durations.map((durationMinutesSnapshot) => ({
      durationMinutesSnapshot,
    })),
  }
}

describe('computeRebookCloneDurationMinutes', () => {
  it('sums the cloned items at their snapshot widths', () => {
    // 90-minute balayage (BASE) + a 30-minute toner (ADD_ON).
    expect(computeRebookCloneDurationMinutes(source([90, 30]))).toBe(120)
  })

  /**
   * The regression this file exists for. A 0-minute retail ADD_ON adds no
   * time to the appointment, so the clone is exactly as wide as the base
   * service — not an hour wider.
   */
  it('does not widen the clone for a 0-minute (instant/retail) add-on', () => {
    expect(computeRebookCloneDurationMinutes(source([90, 0]))).toBe(90)
    expect(computeRebookCloneDurationMinutes(source([90, 0, 0]))).toBe(90)
  })

  it('still falls back to 60 for an ADD_ON whose snapshot is unusable, not 0', () => {
    // null is missing data, not "this add-on takes no time" — the pre-existing
    // fallback must be untouched by the 0 exception above.
    expect(computeRebookCloneDurationMinutes(source([90, null]))).toBe(150)
  })

  /**
   * The BASE item (index 0) never gets the exact-zero exception — a base
   * service can't be an instant/retail item, so a stored 0 there is corrupt
   * data, not a real add-on. Matches the commit's own index-aware treatment
   * in `performLockedCreateRebookedBooking` exactly, so the offer never
   * promises a width the commit sizes differently.
   */
  it('treats a corrupt 0-minute BASE snapshot as unusable, not as a legal zero', () => {
    expect(computeRebookCloneDurationMinutes(source([0]))).toBe(60)
    expect(computeRebookCloneDurationMinutes(source([0, 30]))).toBe(90)
  })

  it('falls back to the booking row total when there are no items at all', () => {
    expect(computeRebookCloneDurationMinutes(source([], 75))).toBe(75)
    expect(computeRebookCloneDurationMinutes(source([], null))).toBe(60)
  })
})
