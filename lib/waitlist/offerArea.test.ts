// lib/waitlist/offerArea.test.ts
//
// The pure half of the mobile-offer privacy rule: what a pro is told about WHERE
// they would travel, before the client has accepted.
import { describe, expect, it } from 'vitest'

import {
  buildWaitlistOfferAreaLabel,
  formatWaitlistOfferTravelSummary,
} from './offerArea'

describe('buildWaitlistOfferAreaLabel', () => {
  it('names the city and state', () => {
    expect(
      buildWaitlistOfferAreaLabel({
        city: 'Coronado',
        state: 'CA',
        postalCodePrefix: '92118',
      }),
    ).toBe('Coronado, CA')
  })

  it('falls back to the postal prefix when there is no city or state', () => {
    expect(
      buildWaitlistOfferAreaLabel({
        city: null,
        state: null,
        postalCodePrefix: '92118',
      }),
    ).toBe('92118')
  })

  it('is null rather than empty when nothing coarse is known', () => {
    // A card that says only "3.2 mi away" is correct. One that invents a place,
    // or renders an empty chip, is not.
    expect(
      buildWaitlistOfferAreaLabel({
        city: null,
        state: null,
        postalCodePrefix: null,
      }),
    ).toBeNull()
    expect(
      buildWaitlistOfferAreaLabel({
        city: '  ',
        state: '',
        postalCodePrefix: '   ',
      }),
    ).toBeNull()
  })

  it('takes only city / state / postal prefix — a street line is not even accepted', () => {
    // 🔴 The load-bearing assertion of this file. The label is built with
    // `buildDiscoveryLocationLabel`, whose documented fallback is
    // `formattedAddress` — for a CLIENT address, that is their front door. This
    // proves the input type has no slot for one, so the fallback cannot fire:
    // an extra key is a type error at every call site AND is ignored here.
    const withStreetSmuggledIn = {
      city: null,
      state: null,
      postalCodePrefix: null,
      formattedAddress: '77 Orange Ave, Coronado, CA 92118',
      addressLine1: '77 Orange Ave',
    }

    expect(buildWaitlistOfferAreaLabel(withStreetSmuggledIn)).toBeNull()
  })
})

describe('formatWaitlistOfferTravelSummary', () => {
  it('reads "<miles> mi away · <area>" when both halves are known', () => {
    expect(
      formatWaitlistOfferTravelSummary({
        distanceMiles: 1.87,
        areaLabel: 'Coronado, CA',
      }),
    ).toBe('1.9 mi away · Coronado, CA')
  })

  it('still reads with only one half', () => {
    expect(
      formatWaitlistOfferTravelSummary({
        distanceMiles: 3.2,
        areaLabel: null,
      }),
    ).toBe('3.2 mi away')
    expect(
      formatWaitlistOfferTravelSummary({
        distanceMiles: null,
        areaLabel: 'Coronado, CA',
      }),
    ).toBe('Coronado, CA')
  })

  it('is null when neither is known — a legacy offer says nothing about the trip', () => {
    expect(
      formatWaitlistOfferTravelSummary({
        distanceMiles: null,
        areaLabel: null,
      }),
    ).toBeNull()
  })

  it('rounds to one decimal, never publishing a precise measurement', () => {
    // Deliberately coarse. The stored value keeps two decimals for the radius
    // audit trail; what the pro READS is rounded, because "how far" is the
    // question and a rooftop-accurate figure is a different one.
    expect(
      formatWaitlistOfferTravelSummary({
        distanceMiles: 1.8712345,
        areaLabel: null,
      }),
    ).toBe('1.9 mi away')
  })

  it('ignores a non-finite distance rather than printing NaN', () => {
    expect(
      formatWaitlistOfferTravelSummary({
        distanceMiles: Number.NaN,
        areaLabel: 'Coronado, CA',
      }),
    ).toBe('Coronado, CA')
  })
})
