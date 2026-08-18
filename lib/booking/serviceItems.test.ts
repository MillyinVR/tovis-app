// lib/booking/serviceItems.test.ts
import { describe, expect, it } from 'vitest'

import { clonedItemDurationMinutes, computeBookingItemLikeTotals } from './serviceItems'
import { isBookingError } from './errors'

// The rebook-clone width shared by the OFFER (rebookWidth.ts) and the COMMIT
// (writeBoundary.ts's performLockedCreateRebookedBooking) — both call sites
// must apply the identical rule or the offer promises a width the commit
// won't take. This module had zero test coverage until 0 became a legal
// add-on duration, at which point the pre-existing "?? 60" fallback would
// have silently inflated every rebook of a 0-minute retail add-on by a
// full hour.
describe('clonedItemDurationMinutes', () => {
  it('preserves an exact zero as legitimate (an instant/retail add-on)', () => {
    expect(clonedItemDurationMinutes(0)).toBe(0)
  })

  it('keeps the pre-existing 60-minute fallback for genuinely unusable data', () => {
    expect(clonedItemDurationMinutes(null)).toBe(60)
    expect(clonedItemDurationMinutes(-5)).toBe(60)
    expect(clonedItemDurationMinutes(Number.NaN)).toBe(60)
  })

  it('floors and clamps a real positive snapshot exactly like normalizePositiveDurationMinutes', () => {
    expect(clonedItemDurationMinutes(5)).toBe(15) // floored
    expect(clonedItemDurationMinutes(45)).toBe(45)
  })
})

// The guard helpers accept an error CODE from the caller. When that code is a
// real BookingErrorCode (writeBoundary passes 'INVALID_SERVICE_ITEMS'), the
// throw must be a BookingError so routes map it to its catalog httpStatus/
// userMessage — a plain Error(code) fails isBookingError and surfaces as a 500
// INTERNAL_ERROR "Failed to update booking." (hit live: rescheduling a booking
// with zero stored BookingServiceItem rows).
describe('computeBookingItemLikeTotals empty-items throw', () => {
  it('throws a BookingError when the caller passes a catalog code', () => {
    let caught: unknown
    try {
      computeBookingItemLikeTotals([], 'INVALID_SERVICE_ITEMS')
    } catch (error) {
      caught = error
    }

    expect(isBookingError(caught)).toBe(true)
    expect(caught).toMatchObject({
      code: 'INVALID_SERVICE_ITEMS',
      httpStatus: 400,
      userMessage: 'Invalid service items.',
    })
  })

  it('keeps a plain Error for non-catalog codes', () => {
    let caught: unknown
    try {
      computeBookingItemLikeTotals([])
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(isBookingError(caught)).toBe(false)
    expect((caught as Error).message).toBe('BAD_ITEMS')
  })
})
