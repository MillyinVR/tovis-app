import { describe, expect, it } from 'vitest'

import { buildPaymentDeepLink } from './paymentDeepLink'

describe('buildPaymentDeepLink', () => {
  it('returns null when the amount is missing or non-positive', () => {
    expect(
      buildPaymentDeepLink({ methodKey: 'venmo', handle: 'jane', amountDue: 0 }),
    ).toBeNull()
    expect(
      buildPaymentDeepLink({ methodKey: 'venmo', handle: 'jane', amountDue: -5 }),
    ).toBeNull()
    expect(
      buildPaymentDeepLink({ methodKey: 'venmo', handle: 'jane', amountDue: NaN }),
    ).toBeNull()
  })

  it('returns null when the handle is missing', () => {
    expect(
      buildPaymentDeepLink({ methodKey: 'venmo', handle: null, amountDue: 80 }),
    ).toBeNull()
    expect(
      buildPaymentDeepLink({ methodKey: 'venmo', handle: '  ', amountDue: 80 }),
    ).toBeNull()
  })

  it('returns null for methods with no off-platform link', () => {
    for (const methodKey of ['cash', 'stripe_card', 'card_on_file', 'tap_to_pay', 'apple_pay']) {
      expect(
        buildPaymentDeepLink({ methodKey, handle: 'jane', amountDue: 80 }),
      ).toBeNull()
    }
  })

  it('builds a Venmo link with a pre-filled amount and note, stripping a leading @', () => {
    const link = buildPaymentDeepLink({
      methodKey: 'venmo',
      handle: '@jane-doe',
      amountDue: 80.5,
      note: 'Tovis',
    })

    expect(link).toEqual({
      kind: 'link',
      href: 'https://venmo.com/jane-doe?txn=pay&amount=80.50&note=Tovis',
      appHref:
        'venmo://paycharge?txn=pay&recipients=jane-doe&amount=80.50&note=Tovis',
      label: 'Pay $80.50 with Venmo',
    })
  })

  // The https URL alone never opens the Venmo app: venmo.com's
  // apple-app-site-association does not claim a bare /<username>, so iOS hands
  // it to Safari, which then gets a 302→307 chain ending at venmo://paycharge —
  // a server redirect into a custom scheme that Safari will not follow. We must
  // emit that scheme ourselves for a mobile caller to navigate to directly.
  it('emits a venmo:// app-scheme URL alongside the web URL', () => {
    const link = buildPaymentDeepLink({
      methodKey: 'venmo',
      handle: 'jane',
      amountDue: 12.3,
      note: 'Tovis',
    })

    expect(link).toMatchObject({ kind: 'link' })
    const appHref = link?.kind === 'link' ? link.appHref : null
    expect(appHref).toBeTruthy()

    const parsed = new URL(appHref ?? '')
    expect(parsed.protocol).toBe('venmo:')
    expect(parsed.searchParams.get('txn')).toBe('pay')
    expect(parsed.searchParams.get('recipients')).toBe('jane')
    expect(parsed.searchParams.get('amount')).toBe('12.30')
    expect(parsed.searchParams.get('note')).toBe('Tovis')
  })

  it('omits the Venmo note from both URLs when none is given', () => {
    const link = buildPaymentDeepLink({
      methodKey: 'venmo',
      handle: 'jane',
      amountDue: 80,
    })

    expect(link).toMatchObject({
      kind: 'link',
      href: 'https://venmo.com/jane?txn=pay&amount=80.00',
      appHref: 'venmo://paycharge?txn=pay&recipients=jane&amount=80.00',
    })
  })

  it('builds a PayPal.Me link with the amount in the path', () => {
    const link = buildPaymentDeepLink({
      methodKey: 'paypal',
      handle: 'jane',
      amountDue: 80,
    })

    expect(link).toEqual({
      kind: 'link',
      href: 'https://paypal.me/jane/80.00',
      label: 'Pay $80.00 with PayPal',
    })
  })

  // paypal.me's apple-app-site-association claims "/*", so the https URL is a
  // genuine universal link and needs no custom-scheme escape hatch.
  it('needs no app-scheme URL for PayPal', () => {
    const link = buildPaymentDeepLink({
      methodKey: 'paypal',
      handle: 'jane',
      amountDue: 80,
    })

    expect(link?.kind === 'link' ? link.appHref : 'unset').toBeUndefined()
  })

  it('extracts the PayPal username from a full paypal.me URL', () => {
    const link = buildPaymentDeepLink({
      methodKey: 'paypal',
      handle: 'https://paypal.me/jane-doe',
      amountDue: 25,
    })

    expect(link).toMatchObject({ href: 'https://paypal.me/jane-doe/25.00' })
  })

  it('returns a copy action for Zelle with an instruction', () => {
    const action = buildPaymentDeepLink({
      methodKey: 'zelle',
      handle: 'jane@example.com',
      amountDue: 80,
    })

    expect(action).toEqual({
      kind: 'copy',
      handle: 'jane@example.com',
      amount: '80.00',
      instruction: 'Open Zelle in your bank app and send $80.00 to jane@example.com.',
    })
  })

  it('returns a copy action for Apple Cash', () => {
    const action = buildPaymentDeepLink({
      methodKey: 'apple_cash',
      handle: '555-123-4567',
      amountDue: 12.5,
    })

    expect(action).toMatchObject({
      kind: 'copy',
      amount: '12.50',
      handle: '555-123-4567',
    })
  })
})
