// lib/booking/checkoutProductsEditable.test.ts
import { describe, expect, it } from 'vitest'
import { BookingCheckoutStatus, BookingStatus } from '@prisma/client'

import {
  clientCanEditBookingCheckoutProducts,
  clientCheckoutProductsEditBlockReason,
  type CheckoutProductsEditState,
} from './checkoutProductsEditable'

const SENT_AT = new Date('2026-07-02T15:00:00.000Z')

// The canonical editable state: a live booking with finalized (sent) aftercare
// and no payment yet. Each test flips exactly one field.
function state(
  overrides: Partial<CheckoutProductsEditState> = {},
): CheckoutProductsEditState {
  return {
    status: BookingStatus.ACCEPTED,
    finishedAt: null,
    checkoutStatus: BookingCheckoutStatus.READY,
    paymentAuthorizedAt: null,
    paymentCollectedAt: null,
    aftercareSentAt: SENT_AT,
    ...overrides,
  }
}

describe('clientCheckoutProductsEditBlockReason', () => {
  it('is editable for a live booking with sent aftercare and no payment', () => {
    expect(clientCheckoutProductsEditBlockReason(state())).toBeNull()
    expect(clientCanEditBookingCheckoutProducts(state())).toBe(true)
  })

  it('blocks a cancelled booking', () => {
    expect(
      clientCheckoutProductsEditBlockReason(
        state({ status: BookingStatus.CANCELLED }),
      ),
    ).toBe('CANCELLED')
  })

  it('blocks a completed booking (by status or finishedAt)', () => {
    expect(
      clientCheckoutProductsEditBlockReason(
        state({ status: BookingStatus.COMPLETED }),
      ),
    ).toBe('COMPLETED')
    expect(
      clientCheckoutProductsEditBlockReason(state({ finishedAt: SENT_AT })),
    ).toBe('COMPLETED')
  })

  it('blocks when aftercare has not been sent', () => {
    expect(
      clientCheckoutProductsEditBlockReason(state({ aftercareSentAt: null })),
    ).toBe('AFTERCARE_NOT_SENT')
  })

  it('blocks once payment is authorized or collected', () => {
    expect(
      clientCheckoutProductsEditBlockReason(
        state({ paymentAuthorizedAt: SENT_AT }),
      ),
    ).toBe('PAYMENT_AUTHORIZED')
    expect(
      clientCheckoutProductsEditBlockReason(
        state({ paymentCollectedAt: SENT_AT }),
      ),
    ).toBe('PAYMENT_COLLECTED')
  })

  it('blocks a locked checkout status (partially paid / paid / waived)', () => {
    for (const checkoutStatus of [
      BookingCheckoutStatus.PARTIALLY_PAID,
      BookingCheckoutStatus.PAID,
      BookingCheckoutStatus.WAIVED,
    ]) {
      expect(
        clientCheckoutProductsEditBlockReason(state({ checkoutStatus })),
      ).toBe('CHECKOUT_LOCKED')
    }
  })

  it('reports completion before the softer aftercare/payment gates', () => {
    // A completed booking with unsent aftercare reports COMPLETED, not
    // AFTERCARE_NOT_SENT — matching the write path's throw order.
    expect(
      clientCheckoutProductsEditBlockReason(
        state({ status: BookingStatus.COMPLETED, aftercareSentAt: null }),
      ),
    ).toBe('COMPLETED')
  })
})
