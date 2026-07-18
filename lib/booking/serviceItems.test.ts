// lib/booking/serviceItems.test.ts
import { describe, expect, it } from 'vitest'

import { computeBookingItemLikeTotals } from './serviceItems'
import { isBookingError } from './errors'

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
