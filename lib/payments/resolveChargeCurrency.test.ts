import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CHARGE_CURRENCY,
  resolveChargeCurrency,
  resolveChargeCurrencyLower,
} from '@/lib/payments/resolveChargeCurrency'

// These pin TODAY's behaviour, which is the whole claim the centralising PR
// makes: eleven call sites moved onto this module and nothing about what
// reaches Stripe changed. If the per-pro Connect resolution described in the
// module header lands, these are the assertions that must be deliberately
// rewritten rather than quietly widened.
describe('resolveChargeCurrency', () => {
  it('pins the default to USD', () => {
    expect(DEFAULT_CHARGE_CURRENCY).toBe('USD')
  })

  it('falls back to USD when no value is stored', () => {
    expect(resolveChargeCurrency(null)).toBe('USD')
    expect(resolveChargeCurrency(undefined)).toBe('USD')
    expect(resolveChargeCurrency()).toBe('USD')
  })

  it('returns the stored value when the column is populated', () => {
    expect(resolveChargeCurrency('usd')).toBe('usd')
    expect(resolveChargeCurrency('eur')).toBe('eur')
  })

  // Booking.stripeCurrency genuinely holds both casings in production:
  // recordStripeCheckoutSessionAttached upper-cases what it stores, while the
  // checkout.session.completed webhook stores Stripe's raw lowercase. The
  // resolver must not silently normalise one into the other — the sites that
  // need Stripe's casing ask for it.
  it('preserves the stored value case rather than normalising it', () => {
    expect(resolveChargeCurrency('USD')).toBe('USD')
    expect(resolveChargeCurrency('usd')).toBe('usd')
  })

  it('does not treat an empty string as absent', () => {
    expect(resolveChargeCurrency('')).toBe('')
  })
})

describe('resolveChargeCurrencyLower', () => {
  it('falls back to Stripe casing when no value is stored', () => {
    expect(resolveChargeCurrencyLower(null)).toBe('usd')
    expect(resolveChargeCurrencyLower(undefined)).toBe('usd')
    expect(resolveChargeCurrencyLower()).toBe('usd')
  })

  it('lower-cases a stored value whichever way it was written', () => {
    expect(resolveChargeCurrencyLower('USD')).toBe('usd')
    expect(resolveChargeCurrencyLower('usd')).toBe('usd')
    expect(resolveChargeCurrencyLower('EUR')).toBe('eur')
  })

  it('agrees with resolveChargeCurrency on everything but case', () => {
    for (const stored of [null, undefined, 'USD', 'usd', 'eur', 'EUR']) {
      expect(resolveChargeCurrencyLower(stored)).toBe(
        resolveChargeCurrency(stored).toLowerCase(),
      )
    }
  })
})
