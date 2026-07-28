import { describe, expect, it } from 'vitest'
import { PaymentMethod } from '@prisma/client'

import {
  buildAcceptedPaymentMethods,
  buildClientSelfServePaymentMethods,
  isUnverifiablePaymentMethod,
  listManualCollectablePaymentMethods,
  normalizePaymentMethodInput,
  type AcceptedPaymentMethodFlags,
} from './acceptedMethods'

function flags(
  overrides: Partial<AcceptedPaymentMethodFlags> = {},
): AcceptedPaymentMethodFlags {
  return {
    acceptCash: false,
    acceptCardOnFile: false,
    acceptTapToPay: false,
    acceptVenmo: false,
    acceptZelle: false,
    acceptAppleCash: false,
    acceptPaypal: false,
    acceptApplePay: false,
    acceptStripeCard: false,
    ...overrides,
  }
}

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

describe('normalizePaymentMethodInput', () => {
  // Regression: PAYPAL and APPLE_PAY were unparseable, so a PayPal confirm was
  // rejected as an unknown method rather than by any deliberate policy. Parsing
  // now covers the whole enum; authorization is the accepted-set's job.
  it('parses every PaymentMethod the schema defines', () => {
    for (const method of Object.values(PaymentMethod)) {
      expect(normalizePaymentMethodInput(method)).toBe(method)
    }
  })

  it('accepts loose spacing and casing', () => {
    expect(normalizePaymentMethodInput('tap to pay')).toBe(
      PaymentMethod.TAP_TO_PAY,
    )
    expect(normalizePaymentMethodInput('  apple-cash ')).toBe(
      PaymentMethod.APPLE_CASH,
    )
  })

  it('returns undefined for a non-method', () => {
    expect(normalizePaymentMethodInput('bitcoin')).toBeUndefined()
    expect(normalizePaymentMethodInput('')).toBeUndefined()
    expect(normalizePaymentMethodInput(null)).toBeUndefined()
  })
})

describe('buildClientSelfServePaymentMethods', () => {
  it('drops the pro-run rails a client cannot execute themselves', () => {
    const settings = flags({
      acceptCash: true,
      acceptCardOnFile: true,
      acceptTapToPay: true,
      acceptApplePay: true,
      acceptVenmo: true,
      acceptPaypal: true,
    })

    // The pro genuinely accepts all six...
    expect(buildAcceptedPaymentMethods(settings).size).toBe(6)

    // ...but a client may only pick the ones they can carry out on their own.
    expect([...buildClientSelfServePaymentMethods(settings)]).toEqual([
      PaymentMethod.CASH,
      PaymentMethod.VENMO,
      PaymentMethod.PAYPAL,
    ])
  })

  it('is empty when the pro has no settings row', () => {
    expect(buildClientSelfServePaymentMethods(null).size).toBe(0)
  })
})

describe('listManualCollectablePaymentMethods', () => {
  // The pro-run rails stay available HERE — a human has actually run the card —
  // and PayPal/Apple Pay are collectable too, which is the only way either gets
  // recorded now that a client can't self-mark them.
  it('offers the pro every accepted method except Stripe', () => {
    const methods = listManualCollectablePaymentMethods(
      flags({
        acceptCash: true,
        acceptCardOnFile: true,
        acceptTapToPay: true,
        acceptApplePay: true,
        acceptPaypal: true,
        acceptStripeCard: true,
      }),
    )

    expect(methods.map((m) => m.value)).toEqual([
      PaymentMethod.CASH,
      PaymentMethod.TAP_TO_PAY,
      PaymentMethod.CARD_ON_FILE,
      PaymentMethod.APPLE_PAY,
      PaymentMethod.PAYPAL,
    ])
  })
})
