// lib/booking/errors.overrides.test.ts
//
// Pins the per-call-site override contract on the booking error catalog.
//
// `uiAction` is the remedy hint, and one code can be reached from surfaces with
// different remedies. TIME_BLOCKED is the live case: the client booking flow
// really can PICK_NEW_SLOT, but a consultation approval is a decision on an
// appointment already underway — there is no slot for the client to pick, so
// that call site downgrades the hint to NONE. The CODE stays TIME_BLOCKED
// because its meaning is unchanged.

import { describe, expect, it } from 'vitest'

import {
  bookingError,
  getBookingErrorDescriptor,
  getBookingFailPayload,
} from './errors'

describe('booking error overrides', () => {
  it('keeps the catalog uiAction when no override is given', () => {
    expect(getBookingErrorDescriptor('TIME_BLOCKED').uiAction).toBe(
      'PICK_NEW_SLOT',
    )
  })

  it('lets a call site override uiAction without changing the code', () => {
    const descriptor = getBookingErrorDescriptor('TIME_BLOCKED', {
      uiAction: 'NONE',
    })

    expect(descriptor.code).toBe('TIME_BLOCKED')
    expect(descriptor.uiAction).toBe('NONE')
    // Untouched fields still come from the catalog.
    expect(descriptor.httpStatus).toBe(409)
    expect(descriptor.retryable).toBe(true)
  })

  it('carries the overridden uiAction onto the thrown BookingError', () => {
    const error = bookingError('TIME_BLOCKED', {
      userMessage: 'These services run into time your pro has blocked off.',
      uiAction: 'NONE',
    })

    expect(error.code).toBe('TIME_BLOCKED')
    expect(error.uiAction).toBe('NONE')
    expect(error.retryable).toBe(true)
  })

  it('carries the overridden uiAction into the wire payload', () => {
    const payload = getBookingFailPayload('TIME_BLOCKED', { uiAction: 'NONE' })

    expect(payload.httpStatus).toBe(409)
    expect(payload.extra.code).toBe('TIME_BLOCKED')
    expect(payload.extra.uiAction).toBe('NONE')
  })
})
