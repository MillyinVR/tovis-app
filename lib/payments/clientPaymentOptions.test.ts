import { describe, expect, it } from 'vitest'

import {
  buildClientAcceptedMethods,
  buildClientPaymentOptions,
  normalizeClientVisiblePaymentSettings,
  normalizeTipSuggestionPercents,
} from './clientPaymentOptions'

type RawRow = Parameters<typeof buildClientPaymentOptions>[0] & object

function makeRow(overrides: Partial<RawRow> = {}): RawRow {
  return {
    collectPaymentAt: 'AFTER_SERVICE',
    acceptCash: false,
    acceptCardOnFile: false,
    acceptTapToPay: false,
    acceptVenmo: false,
    acceptZelle: false,
    acceptAppleCash: false,
    acceptPaypal: false,
    acceptApplePay: false,
    acceptStripeCard: false,
    stripeAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    tipsEnabled: true,
    allowCustomTip: true,
    tipSuggestions: null,
    venmoHandle: null,
    zelleHandle: null,
    appleCashHandle: null,
    paypalHandle: null,
    paymentNote: null,
    ...overrides,
  }
}

describe('normalizeTipSuggestionPercents', () => {
  it('extracts whole percents from the stored {label, percent} shape', () => {
    expect(
      normalizeTipSuggestionPercents([
        { label: '18%', percent: 18 },
        { label: '20%', percent: 20 },
        { label: '25%', percent: 25 },
      ]),
    ).toEqual([18, 20, 25])
  })

  it('accepts a plain numeric / numeric-string array defensively', () => {
    expect(normalizeTipSuggestionPercents([10, '15', 20])).toEqual([10, 15, 20])
  })

  it('truncates, clamps to 0–100, and de-duplicates in order', () => {
    expect(
      normalizeTipSuggestionPercents([20.9, 20, -5, 150, { label: 'x', percent: 30 }]),
    ).toEqual([20, 30])
  })

  it('returns an empty list for a non-array / empty input', () => {
    expect(normalizeTipSuggestionPercents(null)).toEqual([])
    expect(normalizeTipSuggestionPercents(undefined)).toEqual([])
    expect(normalizeTipSuggestionPercents([])).toEqual([])
  })
})

describe('buildClientAcceptedMethods', () => {
  it('falls back to Cash-only when the pro has no settings row', () => {
    expect(buildClientAcceptedMethods(null)).toEqual([
      { key: 'cash', label: 'Cash', handle: null },
    ])
  })

  it('emits methods in the canonical checkout order with their handles', () => {
    const methods = buildClientAcceptedMethods(
      normalizeClientVisiblePaymentSettings(
        makeRow({
          acceptCash: true,
          acceptVenmo: true,
          venmoHandle: '  @amara  ',
          acceptZelle: true,
          zelleHandle: '555-1212',
          acceptStripeCard: true,
          stripeAccountId: 'acct_1',
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        }),
      ),
    )

    expect(methods).toEqual([
      { key: 'cash', label: 'Cash', handle: null },
      { key: 'venmo', label: 'Venmo', handle: '@amara' },
      { key: 'zelle', label: 'Zelle', handle: '555-1212' },
      { key: 'stripe_card', label: 'Credit/debit card', handle: null },
    ])
  })

  it('gates Stripe out when the connected account is not chargeable', () => {
    const methods = buildClientAcceptedMethods(
      normalizeClientVisiblePaymentSettings(
        makeRow({
          acceptCash: true,
          acceptStripeCard: true,
          // no stripeAccountId / charges / payouts → not usable
        }),
      ),
    )

    expect(methods.map((m) => m.key)).toEqual(['cash'])
  })
})

describe('buildClientPaymentOptions', () => {
  it('returns the Cash-only default block when the pro has no settings row', () => {
    expect(buildClientPaymentOptions(null)).toEqual({
      methods: [{ key: 'cash', label: 'Cash', handle: null }],
      tipsEnabled: true,
      allowCustomTip: true,
      tipSuggestions: [],
      paymentNote: null,
      collectPaymentAt: null,
    })
  })

  it('builds methods with handles + normalized tip presets + trimmed note', () => {
    const options = buildClientPaymentOptions(
      makeRow({
        acceptCash: true,
        acceptVenmo: true,
        venmoHandle: '@amara',
        tipsEnabled: true,
        allowCustomTip: false,
        tipSuggestions: [
          { label: '18%', percent: 18 },
          { label: '22%', percent: 22 },
        ],
        paymentNote: '  Zelle preferred  ',
        collectPaymentAt: 'AT_BOOKING',
      }),
    )

    expect(options.methods.map((m) => m.key)).toEqual(['cash', 'venmo'])
    expect(options.methods[1]?.handle).toBe('@amara')
    expect(options.tipsEnabled).toBe(true)
    expect(options.allowCustomTip).toBe(false)
    expect(options.tipSuggestions).toEqual([18, 22])
    expect(options.paymentNote).toBe('Zelle preferred')
    expect(options.collectPaymentAt).toBe('AT_BOOKING')
  })
})
