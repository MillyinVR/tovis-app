// lib/consult/enhancementOffer.test.ts
//
// Book the Look, B7 — the two labels a client reads on an enhancement card.
// Small functions, but they are the entire client-facing arithmetic of the
// slice, so each rule that keeps "+$0" off a screen gets a case.

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  formatEnhancementDurationDelta,
  formatEnhancementPriceDelta,
} from './enhancementOffer'

describe('the price delta', () => {
  it('is signed, so it reads as an addition rather than a total', () => {
    expect(formatEnhancementPriceDelta('40.00')).toBe('+$40')
    expect(formatEnhancementPriceDelta(new Prisma.Decimal('40.00'))).toBe('+$40')
  })

  // A complimentary service is a real thing a pro lists (serviceEstimate lets a
  // zero price through on purpose). It adds no money and must print no money.
  it('is null for a complimentary enhancement, never "+$0"', () => {
    expect(formatEnhancementPriceDelta('0.00')).toBeNull()
    expect(formatEnhancementPriceDelta(new Prisma.Decimal(0))).toBeNull()
  })

  it('is null for nothing at all', () => {
    expect(formatEnhancementPriceDelta(null)).toBeNull()
    expect(formatEnhancementPriceDelta(undefined)).toBeNull()
  })

  // 🔴 The amount decides, not the rendered string: a price that ROUNDS to "$0"
  // is still a price, and matching the label would drop the "+" off a real one.
  it('keeps a sub-dollar price rather than mistaking it for free', () => {
    expect(formatEnhancementPriceDelta('0.40')).toBe('+$0')
  })
})

describe('the duration delta', () => {
  it('is signed and reads in minutes below the hour', () => {
    expect(formatEnhancementDurationDelta(20)).toBe('+20 min')
  })

  it('reads in hours above it', () => {
    expect(formatEnhancementDurationDelta(90)).toBe('+1h 30m')
    expect(formatEnhancementDurationDelta(120)).toBe('+2h')
  })

  // An instant enhancement adds no time; "+0 min" is noise on a card.
  it('is null for an instant enhancement', () => {
    expect(formatEnhancementDurationDelta(0)).toBeNull()
    expect(formatEnhancementDurationDelta(null)).toBeNull()
  })
})
