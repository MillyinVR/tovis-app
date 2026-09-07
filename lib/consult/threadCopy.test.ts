// lib/consult/threadCopy.test.ts
//
// P7a-5 — the money line under the sticky CTA.
//
// It is composed on the SERVER precisely so there is one implementation to
// test; these assertions are what both clients then render verbatim.

import { describe, expect, it } from 'vitest'

import { defaultClientConsultThreadCopy as copy } from '@/lib/brand/defaultClientConsultThreadCopy'

import { consultThreadBookPriceNote, fillConsultThreadCopy } from './threadCopy'

describe('consultThreadBookPriceNote', () => {
  it('joins the price and a flat deposit', () => {
    expect(
      consultThreadBookPriceNote(copy, {
        priceLabel: 'From $180',
        charge: { kind: 'FLAT', amountCents: 2500 },
      }),
    ).toBe('From $180 · $25.00 deposit')
  })

  it('renders a percentage deposit as a percentage', () => {
    // 🔴 Never dollars. At the spark there is no location mode and no add-ons,
    // so the subtotal a percentage applies to does not exist yet — a figure
    // here would be a guess shown as a promise.
    expect(
      consultThreadBookPriceNote(copy, {
        priceLabel: 'From $180',
        charge: { kind: 'PERCENT', percent: 20 },
      }),
    ).toBe('From $180 · 20% deposit')
  })

  it('says the whole price is due when the service is prepay-required', () => {
    expect(
      consultThreadBookPriceNote(copy, {
        priceLabel: 'From $180',
        charge: { kind: 'PREPAY' },
      }),
    ).toBe('From $180 · paid in full when you book')
  })

  it('shows the price alone when nothing is owed up front', () => {
    expect(
      consultThreadBookPriceNote(copy, { priceLabel: 'From $180', charge: null }),
    ).toBe('From $180')
  })

  it('shows the deposit alone when the look carries no price', () => {
    // A look with no price still has a charge worth disclosing; degrading to
    // silence here would hide money rather than a missing estimate.
    expect(
      consultThreadBookPriceNote(copy, {
        priceLabel: null,
        charge: { kind: 'FLAT', amountCents: 2500 },
      }),
    ).toBe('$25.00 deposit')
  })

  it('is null when there is nothing to say', () => {
    expect(consultThreadBookPriceNote(copy, { priceLabel: null, charge: null })).toBeNull()
  })
})

describe('fillConsultThreadCopy — P7a-5 slots', () => {
  it('fills the prep gate note with the pro name', () => {
    expect(
      fillConsultThreadCopy(copy.bookCtaPrepRequired, { pro: 'Susie' }),
    ).toBe('Susie asks clients to finish a few questions first.')
  })

  it('leaves an unfilled slot ALONE rather than blanking it', () => {
    // The module's standing rule: "You're on 's calendar" is worse than a
    // sentence that was never rendered, so callers pick a slot-free variant.
    expect(fillConsultThreadCopy('{amount} deposit', {})).toBe('{amount} deposit')
  })
})
