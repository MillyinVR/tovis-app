import { describe, it, expect } from 'vitest'
import { BookingDiscoveryProvenance } from '@prisma/client'

import {
  resolveDiscoveryProvenance,
  type DiscoveryProvenanceSignals,
} from '@/lib/booking/discoveryProvenance'

const NONE: DiscoveryProvenanceSignals = {
  proCreated: false,
  aftercare: false,
  arrivedViaProNfc: false,
  validLookPost: false,
  discoveryViewKind: null,
}

describe('resolveDiscoveryProvenance', () => {
  it('defaults to DIRECT_PROFILE when nothing proves a discovery origin', () => {
    expect(resolveDiscoveryProvenance(NONE)).toBe(
      BookingDiscoveryProvenance.DIRECT_PROFILE,
    )
  })

  it('resolves a validated Looks-feed reference to LOOKS_FEED', () => {
    expect(resolveDiscoveryProvenance({ ...NONE, validLookPost: true })).toBe(
      BookingDiscoveryProvenance.LOOKS_FEED,
    )
  })

  it('honors a server-recorded discovery-view attribution', () => {
    expect(
      resolveDiscoveryProvenance({ ...NONE, discoveryViewKind: 'DISCOVERY_SEARCH' }),
    ).toBe(BookingDiscoveryProvenance.DISCOVERY_SEARCH)
    expect(
      resolveDiscoveryProvenance({ ...NONE, discoveryViewKind: 'LOOKS_FEED' }),
    ).toBe(BookingDiscoveryProvenance.LOOKS_FEED)
  })

  it('prefers a validated lookPost over a (weaker) discovery-view attribution', () => {
    expect(
      resolveDiscoveryProvenance({
        ...NONE,
        validLookPost: true,
        discoveryViewKind: 'DISCOVERY_SEARCH',
      }),
    ).toBe(BookingDiscoveryProvenance.LOOKS_FEED)
  })

  it('NFC beats discovery signals (a tap means they already had the pro card)', () => {
    expect(
      resolveDiscoveryProvenance({
        ...NONE,
        arrivedViaProNfc: true,
        validLookPost: true,
        discoveryViewKind: 'LOOKS_FEED',
      }),
    ).toBe(BookingDiscoveryProvenance.NFC)
  })

  it('aftercare and pro-created take top precedence', () => {
    expect(
      resolveDiscoveryProvenance({ ...NONE, aftercare: true, validLookPost: true }),
    ).toBe(BookingDiscoveryProvenance.AFTERCARE)
    expect(
      resolveDiscoveryProvenance({
        ...NONE,
        proCreated: true,
        aftercare: true,
        arrivedViaProNfc: true,
      }),
    ).toBe(BookingDiscoveryProvenance.PRO_CREATED)
  })
})
