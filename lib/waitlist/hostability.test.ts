// lib/waitlist/hostability.test.ts
//
// The pure half of the waitlist hostability rule — the half the availability
// bootstrap uses, where paying for a capability query on a cached hot path is
// not an option. `loadWaitlistHostability` (the DB half) is driven for real in
// tests/integration/waitlist-location-capability.test.ts.
import { describe, expect, it } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

import {
  isWaitlistSupportedForModes,
  WAITLIST_FULFILLABLE_MODES,
  waitlistHostableModes,
  waitlistRefusalMessage,
} from './hostability'

describe('waitlistHostableModes', () => {
  it('offers SALON to a pro narrowed to in-salon', () => {
    expect(
      waitlistHostableModes({ offersInSalon: true, offersMobile: false }),
    ).toEqual([ServiceLocationType.SALON])
  })

  it('offers nothing to a mobile-only pro — a travel offer cannot be confirmed', () => {
    expect(
      waitlistHostableModes({ offersInSalon: false, offersMobile: true }),
    ).toEqual([])
  })

  it('offers nothing when neither mode survived narrowing', () => {
    expect(
      waitlistHostableModes({ offersInSalon: false, offersMobile: false }),
    ).toEqual([])
  })

  it('drops the unfulfillable half of a both-modes pro rather than promising it', () => {
    expect(
      waitlistHostableModes({ offersInSalon: true, offersMobile: true }),
    ).toEqual([ServiceLocationType.SALON])
  })
})

describe('WAITLIST_FULFILLABLE_MODES', () => {
  // A canary, not a restatement. MOBILE is excluded because
  // `confirmClientWaitlistOffer` books with `clientAddressId: null` and
  // `WaitlistOffer` has nowhere to carry one — so a MOBILE offer would be
  // created and then be impossible for the client to accept. Widening this list
  // without that plumbing ships a promise nobody can take up, which is why this
  // asserts the list itself and not just a behaviour derived from it.
  it('is SALON-only until an offer can carry a client address', () => {
    expect([...WAITLIST_FULFILLABLE_MODES]).toEqual([ServiceLocationType.SALON])
  })
})

describe('isWaitlistSupportedForModes', () => {
  it('is the "should the drawer show a waitlist at all" answer', () => {
    expect(
      isWaitlistSupportedForModes({ offersInSalon: true, offersMobile: false }),
    ).toBe(true)
    expect(
      isWaitlistSupportedForModes({ offersInSalon: false, offersMobile: true }),
    ).toBe(false)
    expect(
      isWaitlistSupportedForModes({ offersInSalon: false, offersMobile: false }),
    ).toBe(false)
  })
})

describe('waitlistRefusalMessage', () => {
  it('tells a mobile-only pro’s client which of the two walls they hit', () => {
    const mobileOnly = waitlistRefusalMessage({
      kind: 'NO_HOSTABLE_MODE',
      advertisesMobileOnly: true,
    })
    const nothingBookable = waitlistRefusalMessage({
      kind: 'NO_HOSTABLE_MODE',
      advertisesMobileOnly: false,
    })

    expect(mobileOnly).toContain('only travels to clients')
    expect(nothingBookable).toContain('cannot take in-salon appointments')
    expect(mobileOnly).not.toEqual(nothingBookable)
  })

  it('names a missing offering as its own case', () => {
    expect(waitlistRefusalMessage({ kind: 'NO_ACTIVE_OFFERING' })).toContain(
      'not currently offering this service',
    )
  })
})
