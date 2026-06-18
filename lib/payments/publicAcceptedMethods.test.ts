import { describe, expect, it } from 'vitest'

import {
  listPublicAcceptedMethods,
  type PublicPaymentMethodsRow,
} from './publicAcceptedMethods'

function makeRow(
  overrides: Partial<PublicPaymentMethodsRow> = {},
): PublicPaymentMethodsRow {
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
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    ...overrides,
  }
}

describe('listPublicAcceptedMethods', () => {
  it('returns an empty list when the pro has no settings row', () => {
    expect(listPublicAcceptedMethods(null)).toEqual([])
  })

  it('returns an empty list when nothing is enabled', () => {
    expect(listPublicAcceptedMethods(makeRow())).toEqual([])
  })

  it('includes each enabled off-platform method by type', () => {
    const keys = listPublicAcceptedMethods(
      makeRow({
        acceptCash: true,
        acceptVenmo: true,
        acceptZelle: true,
        acceptAppleCash: true,
        acceptPaypal: true,
        acceptApplePay: true,
      }),
    ).map((m) => m.key)

    expect(keys).toEqual([
      'cash',
      'venmo',
      'zelle',
      'apple_cash',
      'paypal',
      'apple_pay',
    ])
  })

  it('never exposes a handle field on a returned method', () => {
    const methods = listPublicAcceptedMethods(
      makeRow({ acceptVenmo: true, acceptZelle: true }),
    )

    for (const method of methods) {
      expect(Object.keys(method).sort()).toEqual(['key', 'label'])
    }
  })

  it('only shows Stripe card when charges AND payouts are enabled', () => {
    // Flag on but account not usable → hidden.
    expect(
      listPublicAcceptedMethods(
        makeRow({ acceptStripeCard: true, stripeChargesEnabled: true }),
      ).some((m) => m.key === 'stripe_card'),
    ).toBe(false)

    // Fully usable connected account → shown.
    expect(
      listPublicAcceptedMethods(
        makeRow({
          acceptStripeCard: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        }),
      ).some((m) => m.key === 'stripe_card'),
    ).toBe(true)
  })
})
