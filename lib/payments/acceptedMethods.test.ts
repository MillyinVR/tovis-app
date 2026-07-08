import { describe, expect, it } from 'vitest'
import { PaymentMethod } from '@prisma/client'

import { isUnverifiablePaymentMethod } from './acceptedMethods'

describe('isUnverifiablePaymentMethod', () => {
  it('flags off-platform methods whose receipt only the pro can confirm', () => {
    for (const method of [
      PaymentMethod.CASH,
      PaymentMethod.VENMO,
      PaymentMethod.ZELLE,
      PaymentMethod.APPLE_CASH,
      PaymentMethod.PAYPAL,
    ]) {
      expect(isUnverifiablePaymentMethod(method)).toBe(true)
    }
  })

  it('treats card rails as verifiable (immediate PAID path)', () => {
    for (const method of [
      PaymentMethod.STRIPE_CARD,
      PaymentMethod.CARD_ON_FILE,
      PaymentMethod.TAP_TO_PAY,
      PaymentMethod.APPLE_PAY,
    ]) {
      expect(isUnverifiablePaymentMethod(method)).toBe(false)
    }
  })

  it('returns false when no method is chosen', () => {
    expect(isUnverifiablePaymentMethod(null)).toBe(false)
    expect(isUnverifiablePaymentMethod(undefined)).toBe(false)
  })
})
