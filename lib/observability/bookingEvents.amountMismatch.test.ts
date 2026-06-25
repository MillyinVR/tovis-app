// lib/observability/bookingEvents.amountMismatch.test.ts
//
// Coverage for captureStripeAmountMismatch: it must raise a Sentry error-level
// message + a structured log line so a short/over/wrong-currency capture can't
// pass silently.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({
      setLevel: vi.fn(),
      setTag: vi.fn(),
      setContext: vi.fn(),
    }),
  ),
}))

vi.mock('@sentry/nextjs', () => sentry)

import { captureStripeAmountMismatch } from './bookingEvents'

beforeEach(() => {
  sentry.captureMessage.mockReset()
  sentry.withScope.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('captureStripeAmountMismatch', () => {
  it('emits a Sentry error message and a structured log line on mismatch', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    captureStripeAmountMismatch({
      bookingId: 'booking_1',
      expectedCents: 10000,
      receivedCents: 9000,
      currency: 'usd',
    })

    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('booking_1'),
      'error',
    )

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.parse(errorSpy.mock.calls[0]?.[0] as string)
    expect(logged).toMatchObject({
      event: 'amount_mismatch',
      bookingId: 'booking_1',
      expectedCents: 10000,
      receivedCents: 9000,
      deltaCents: -1000,
      currency: 'usd',
    })

    errorSpy.mockRestore()
  })
})
