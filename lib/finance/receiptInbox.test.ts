import { describe, expect, it } from 'vitest'

import {
  detectReceiptVendor,
  extractInboxHandle,
  parseReceiptAmountCents,
  resolveReceiptInboxAddress,
} from './receiptInbox'

describe('resolveReceiptInboxAddress', () => {
  it('gives premium pros with a handle their <handle>@tovis.me address', () => {
    expect(resolveReceiptInboxAddress({ handle: 'jadehair', isPremium: true })).toBe(
      'jadehair@tovis.me',
    )
  })

  it('is null without premium or without a handle', () => {
    expect(resolveReceiptInboxAddress({ handle: 'jadehair', isPremium: false })).toBeNull()
    expect(resolveReceiptInboxAddress({ handle: null, isPremium: true })).toBeNull()
    expect(resolveReceiptInboxAddress({ handle: '  ', isPremium: true })).toBeNull()
  })
})

describe('extractInboxHandle', () => {
  it('pulls the handle from an address on the inbox domain', () => {
    expect(extractInboxHandle(['jadehair@tovis.me'])).toBe('jadehair')
    expect(extractInboxHandle(['Jade <JadeHair@Tovis.ME>'])).toBe('jadehair')
  })

  it('ignores addresses on other domains', () => {
    expect(extractInboxHandle(['jade@gmail.com', 'jadehair@tovis.me'])).toBe('jadehair')
    expect(extractInboxHandle(['jade@gmail.com'])).toBeNull()
    expect(extractInboxHandle([])).toBeNull()
  })
})

describe('parseReceiptAmountCents', () => {
  it('picks the largest dollar amount as the order-total heuristic', () => {
    expect(
      parseReceiptAmountCents('Subtotal $40.00, Tax $3.50, Total $43.50'),
    ).toBe(4350)
    expect(parseReceiptAmountCents('Your order for $1,234.56 shipped')).toBe(123456)
  })

  it('returns null when there is no amount', () => {
    expect(parseReceiptAmountCents('Thanks for your order!')).toBeNull()
  })
})

describe('detectReceiptVendor', () => {
  it('tags CosmoProf / Salon Centric, else generic EMAIL', () => {
    expect(detectReceiptVendor('order@cosmoprof.com')).toEqual({
      source: 'COSMOPROF',
      vendor: 'CosmoProf',
    })
    expect(detectReceiptVendor('SalonCentric receipt').source).toBe('SALON_CENTRIC')
    expect(detectReceiptVendor('Amazon order').source).toBe('EMAIL')
  })
})
