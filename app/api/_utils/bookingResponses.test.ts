// app/api/_utils/bookingResponses.test.ts
//
// Route catch blocks serialize a thrown BookingError. They used to hand-forward
// `{ message, userMessage }` and let the payload builder re-derive everything
// else from the catalog — which silently dropped a call-site `uiAction`
// override. The consultation approval downgrades TIME_BLOCKED's remedy from
// PICK_NEW_SLOT to NONE (the client has no slot to pick, the pro has to amend
// the proposal), and the wire kept advertising PICK_NEW_SLOT anyway.
//
// `bookingErrorJsonFail` takes the error itself so no field can be forgotten.
// These assert on what reaches `jsonFail` — i.e. the actual response envelope —
// rather than on a cast return value.

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
}))

import { bookingErrorJsonFail, bookingJsonFail } from './bookingResponses'
import { bookingError } from '@/lib/booking/errors'

describe('bookingErrorJsonFail', () => {
  it('forwards a call-site uiAction override onto the wire', () => {
    bookingErrorJsonFail(
      bookingError('TIME_BLOCKED', {
        message: 'Consultation extension runs into blocked time.',
        userMessage: 'These services run into time your pro has blocked off.',
        uiAction: 'NONE',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'These services run into time your pro has blocked off.',
      expect.objectContaining({
        code: 'TIME_BLOCKED',
        // The whole point: NOT the catalog's PICK_NEW_SLOT.
        uiAction: 'NONE',
        retryable: true,
      }),
    )
  })

  it('still uses the catalog uiAction when the throw site did not override it', () => {
    bookingErrorJsonFail(bookingError('TIME_BLOCKED'))

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      expect.any(String),
      expect.objectContaining({
        code: 'TIME_BLOCKED',
        uiAction: 'PICK_NEW_SLOT',
      }),
    )
  })

  it('bookingJsonFail keeps working from a bare code', () => {
    bookingJsonFail('TIME_BOOKED')

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      expect.any(String),
      expect.objectContaining({
        code: 'TIME_BOOKED',
        uiAction: 'PICK_NEW_SLOT',
      }),
    )
  })
})
