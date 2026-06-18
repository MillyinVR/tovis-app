import { describe, it, expect } from 'vitest'
import { BookingDiscoveryProvenance } from '@prisma/client'

import {
  isNewDiscoveryClient,
  isDiscoveryProvenance,
  resolveDiscoveryFeeCents,
  DEFAULT_DISCOVERY_FEE_CENTS,
  MAX_DISCOVERY_FEE_CENTS,
  type DiscoveryClientSignals,
} from '@/lib/booking/discoveryFee'

// A brand-new cold-discovery client with a deposit-enabled, Stripe-ready pro: the
// canonical "charge the fee" case. Individual tests override single fields.
const NEW_DISCOVERY: DiscoveryClientSignals = {
  provenance: BookingDiscoveryProvenance.LOOKS_FEED,
  proDepositEnabled: true,
  proStripeReady: true,
  establishedBookingCount: 0,
  acceptedInviteCount: 0,
  threadCount: 0,
  arrivedViaProNfc: false,
}

describe('isNewDiscoveryClient', () => {
  it('charges a brand-new client found via the Looks feed', () => {
    expect(isNewDiscoveryClient(NEW_DISCOVERY)).toBe(true)
  })

  it('charges a brand-new client found via the Discovery tab', () => {
    expect(
      isNewDiscoveryClient({
        ...NEW_DISCOVERY,
        provenance: BookingDiscoveryProvenance.DISCOVERY_SEARCH,
      }),
    ).toBe(true)
  })

  it('exempts non-discovery provenance (direct, name search, NFC, aftercare, unknown)', () => {
    for (const provenance of [
      BookingDiscoveryProvenance.DIRECT_PROFILE,
      BookingDiscoveryProvenance.NAME_SEARCH,
      BookingDiscoveryProvenance.NFC,
      BookingDiscoveryProvenance.AFTERCARE,
      BookingDiscoveryProvenance.PRO_CREATED,
      BookingDiscoveryProvenance.UNKNOWN,
    ]) {
      expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, provenance })).toBe(false)
    }
  })

  it('exempts when the pro has no deposit enabled', () => {
    expect(
      isNewDiscoveryClient({ ...NEW_DISCOVERY, proDepositEnabled: false }),
    ).toBe(false)
  })

  it('does not charge when the pro cannot take a platform charge (not Stripe-ready)', () => {
    expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, proStripeReady: false })).toBe(false)
  })

  it('exempts a returning client with an established (non-refunded) booking', () => {
    expect(
      isNewDiscoveryClient({ ...NEW_DISCOVERY, establishedBookingCount: 1 }),
    ).toBe(false)
  })

  it('exempts a client on the pro roster (accepted invite)', () => {
    expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, acceptedInviteCount: 1 })).toBe(false)
  })

  it('exempts a client who has messaged the pro', () => {
    expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, threadCount: 1 })).toBe(false)
  })

  it('exempts a client who arrived via the pro NFC card', () => {
    expect(isNewDiscoveryClient({ ...NEW_DISCOVERY, arrivedViaProNfc: true })).toBe(false)
  })

  it('re-charges after a refund reset: a cancelled+refunded prior booking does NOT establish the relationship', () => {
    // The caller excludes fee-refunded cancellations from establishedBookingCount, so
    // the only prior contact (a refunded discovery booking) leaves the pair "new".
    expect(
      isNewDiscoveryClient({
        ...NEW_DISCOVERY,
        establishedBookingCount: 0, // refunded booking excluded by the query
        acceptedInviteCount: 0,
        threadCount: 0,
      }),
    ).toBe(true)
  })
})

describe('resolveDiscoveryFeeCents', () => {
  it('defaults when unset or blank', () => {
    expect(resolveDiscoveryFeeCents(undefined)).toBe(DEFAULT_DISCOVERY_FEE_CENTS)
    expect(resolveDiscoveryFeeCents('')).toBe(DEFAULT_DISCOVERY_FEE_CENTS)
    expect(resolveDiscoveryFeeCents('   ')).toBe(DEFAULT_DISCOVERY_FEE_CENTS)
  })

  it('honors a valid configured value (e.g. $10)', () => {
    expect(resolveDiscoveryFeeCents('1000')).toBe(1000)
  })

  it('clamps above the max', () => {
    expect(resolveDiscoveryFeeCents('5000')).toBe(MAX_DISCOVERY_FEE_CENTS)
  })

  it('falls back to default on garbage / non-integer input', () => {
    expect(resolveDiscoveryFeeCents('abc')).toBe(DEFAULT_DISCOVERY_FEE_CENTS)
    expect(resolveDiscoveryFeeCents('5.5')).toBe(DEFAULT_DISCOVERY_FEE_CENTS)
  })
})
