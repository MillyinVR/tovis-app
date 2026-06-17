// lib/booking/rampedUnitPrice.test.ts
//
// Pure tests for the quote-time ramp resolution used by the booking charge
// paths. The existing-client DB lookup in resolveChargedUnitPrice is exercised
// end-to-end through the wired booking flow against the local dev DB.

import { Prisma, ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { pickOfferingModeRamp, pickRampedUnitPrice } from './rampedUnitPrice'

const dec = (n: string | number) => new Prisma.Decimal(n)

const salonRamp = {
  mode: ServiceLocationType.SALON,
  currentPrice: dec(30),
  targetPrice: dec(50),
  startedAt: new Date('2026-06-17T00:00:00.000Z'),
}
const mobileRamp = {
  mode: ServiceLocationType.MOBILE,
  currentPrice: dec(40),
  targetPrice: dec(70),
  startedAt: new Date('2026-06-17T00:00:00.000Z'),
}

describe('pickOfferingModeRamp', () => {
  it('returns the ramp matching the booking mode', () => {
    const ramps = [salonRamp, mobileRamp]
    expect(pickOfferingModeRamp(ramps, ServiceLocationType.SALON)?.targetPrice.toNumber()).toBe(50)
    expect(pickOfferingModeRamp(ramps, ServiceLocationType.MOBILE)?.currentPrice.toNumber()).toBe(40)
  })

  it('returns null when the mode has no ramp', () => {
    expect(pickOfferingModeRamp([salonRamp], ServiceLocationType.MOBILE)).toBeNull()
  })

  it('returns null for an empty / missing ramp list', () => {
    expect(pickOfferingModeRamp([], ServiceLocationType.SALON)).toBeNull()
    expect(pickOfferingModeRamp(null, ServiceLocationType.SALON)).toBeNull()
    expect(pickOfferingModeRamp(undefined, ServiceLocationType.SALON)).toBeNull()
  })
})

describe('pickRampedUnitPrice', () => {
  it('charges the stored list price when there is no ramp (preserving cents)', () => {
    const price = pickRampedUnitPrice({
      listPrice: dec('45.50'),
      minPrice: dec('40'),
      ramp: null,
      isExistingClient: false,
    })
    expect(price.toFixed(2)).toBe('45.50')
  })

  it('floors a below-minimum list price to the catalog minimum when there is no ramp', () => {
    const price = pickRampedUnitPrice({
      listPrice: dec('30'),
      minPrice: dec('50'),
      ramp: null,
      isExistingClient: true,
    })
    expect(price.toNumber()).toBe(50)
  })

  it('charges a new client the ramp target (catalog minimum)', () => {
    const price = pickRampedUnitPrice({
      listPrice: dec(50),
      minPrice: dec(50),
      ramp: { currentPrice: dec(30), targetPrice: dec(50), startedAt: salonRamp.startedAt },
      isExistingClient: false,
    })
    expect(price.toNumber()).toBe(50)
  })

  it('charges an existing client the current ramped price (grace discount)', () => {
    const price = pickRampedUnitPrice({
      listPrice: dec(50),
      minPrice: dec(50),
      ramp: { currentPrice: dec(33), targetPrice: dec(50), startedAt: salonRamp.startedAt },
      isExistingClient: true,
    })
    expect(price.toNumber()).toBe(33)
  })
})
