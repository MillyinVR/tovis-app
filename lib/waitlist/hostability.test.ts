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

  it('offers MOBILE to a pro narrowed to travel-only', () => {
    // Was `[]` until 2026-08-27: a mobile offer could not be confirmed, because
    // the offer had nowhere to carry a client address. It does now.
    expect(
      waitlistHostableModes({ offersInSalon: false, offersMobile: true }),
    ).toEqual([ServiceLocationType.MOBILE])
  })

  it('offers nothing when neither mode survived narrowing', () => {
    expect(
      waitlistHostableModes({ offersInSalon: false, offersMobile: false }),
    ).toEqual([])
  })

  it('offers both to a pro who can host both', () => {
    expect(
      waitlistHostableModes({ offersInSalon: true, offersMobile: true }),
    ).toEqual([ServiceLocationType.SALON, ServiceLocationType.MOBILE])
  })

  it('still drops a mode the pro cannot host', () => {
    // The narrowing half of the rule, unchanged by widening the fulfillable
    // list: flags arrive here already narrowed to bookable locations.
    expect(
      waitlistHostableModes({ offersInSalon: false, offersMobile: false }),
    ).toEqual([])
  })
})

describe('WAITLIST_FULFILLABLE_MODES', () => {
  // A canary, not a restatement. It asserts the LIST rather than a behaviour
  // derived from it, because the failure it guards against is a mode being added
  // here ahead of the plumbing that lets a client actually confirm it.
  //
  // It was SALON-only until 2026-08-27. MOBILE joined it together with
  // `WaitlistOffer.clientAddressId`, the radius check at offer time, and the
  // confirm passing that address through to `performLockedCreateProBooking` —
  // the three things that turn a mobile offer from a promise nobody can take up
  // into a bookable one.
  it('is exactly the modes a client can confirm unaided', () => {
    expect([...WAITLIST_FULFILLABLE_MODES]).toEqual([
      ServiceLocationType.SALON,
      ServiceLocationType.MOBILE,
    ])
  })
})

describe('isWaitlistSupportedForModes', () => {
  it('is the "should the drawer show a waitlist at all" answer', () => {
    expect(
      isWaitlistSupportedForModes({ offersInSalon: true, offersMobile: false }),
    ).toBe(true)
    // A mobile-only pro's clients may now join: the offer they'd receive is one
    // they can confirm.
    expect(
      isWaitlistSupportedForModes({ offersInSalon: false, offersMobile: true }),
    ).toBe(true)
    expect(
      isWaitlistSupportedForModes({ offersInSalon: false, offersMobile: false }),
    ).toBe(false)
  })
})

describe('waitlistRefusalMessage', () => {
  it('names an unhostable service without claiming a mode limit that no longer exists', () => {
    const nothingBookable = waitlistRefusalMessage({
      kind: 'NO_HOSTABLE_MODE',
    })

    expect(nothingBookable).toContain('cannot take appointments')
    // The old wording promised in-salon as the workaround. With MOBILE
    // fulfillable that is no longer the reason anyone lands here, and a refusal
    // that names the wrong cause sends the client to fix the wrong thing.
    expect(nothingBookable).not.toContain('in-salon')
    expect(nothingBookable).not.toContain('only travels')
  })

  it('names a missing offering as its own case', () => {
    expect(waitlistRefusalMessage({ kind: 'NO_ACTIVE_OFFERING' })).toContain(
      'not currently offering this service',
    )
  })
})
