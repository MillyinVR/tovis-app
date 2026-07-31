import { describe, expect, it } from 'vitest'
import { BookingDiscoveryProvenance, DepositScope } from '@prisma/client'

import {
  isDepositRequired,
  type DepositRequirementSignals,
} from '@/lib/booking/depositRequirement'
import { isNewDiscoveryClient } from '@/lib/booking/discoveryFee'

const PROVENANCES = Object.values(BookingDiscoveryProvenance)

function signals(
  overrides: Partial<DepositRequirementSignals> = {},
): DepositRequirementSignals {
  return {
    scope: DepositScope.NEW_DISCOVERY_ONLY,
    proDepositEnabled: true,
    proStripeReady: true,
    provenance: BookingDiscoveryProvenance.LOOKS_FEED,
    hasPriorRelationship: false,
    ...overrides,
  }
}

describe('isDepositRequired', () => {
  describe('gates that apply whatever the scope', () => {
    it.each(Object.values(DepositScope))(
      'refuses a pro with deposits switched off (%s)',
      (scope) => {
        expect(isDepositRequired(signals({ scope, proDepositEnabled: false }))).toBe(
          false,
        )
      },
    )

    // Requiring a deposit a pro cannot receive would strand the booking PENDING
    // with no way to pay it.
    it.each(Object.values(DepositScope))(
      'refuses a pro who cannot take a destination charge (%s)',
      (scope) => {
        expect(isDepositRequired(signals({ scope, proStripeReady: false }))).toBe(
          false,
        )
      },
    )
  })

  describe('NEW_DISCOVERY_ONLY — the default', () => {
    const scope = DepositScope.NEW_DISCOVERY_ONLY

    it('requires a deposit from a new client found via the Looks feed', () => {
      expect(isDepositRequired(signals({ scope }))).toBe(true)
    })

    it('requires a deposit from a new client found via Discovery search', () => {
      expect(
        isDepositRequired(
          signals({
            scope,
            provenance: BookingDiscoveryProvenance.DISCOVERY_SEARCH,
          }),
        ),
      ).toBe(true)
    })

    it('exempts a returning client', () => {
      expect(isDepositRequired(signals({ scope, hasPriorRelationship: true }))).toBe(
        false,
      )
    })

    it.each(
      PROVENANCES.filter(
        (p) =>
          p !== BookingDiscoveryProvenance.LOOKS_FEED &&
          p !== BookingDiscoveryProvenance.DISCOVERY_SEARCH,
      ),
    )('exempts a new client who arrived some other way (%s)', (provenance) => {
      expect(isDepositRequired(signals({ scope, provenance }))).toBe(false)
    })
  })

  describe('ALL_NEW_CLIENTS', () => {
    const scope = DepositScope.ALL_NEW_CLIENTS

    // The whole point of the setting: a first-timer who searched the pro by
    // name owes a deposit, where NEW_DISCOVERY_ONLY would have exempted them.
    it.each(PROVENANCES)(
      'requires a deposit from any first-time client, however they arrived (%s)',
      (provenance) => {
        expect(isDepositRequired(signals({ scope, provenance }))).toBe(true)
      },
    )

    it('exempts a returning client', () => {
      expect(isDepositRequired(signals({ scope, hasPriorRelationship: true }))).toBe(
        false,
      )
    })
  })

  describe('ALL_CLIENTS', () => {
    const scope = DepositScope.ALL_CLIENTS

    it('requires a deposit from a returning client too', () => {
      expect(isDepositRequired(signals({ scope, hasPriorRelationship: true }))).toBe(
        true,
      )
    })

    it.each(PROVENANCES)('requires a deposit whatever the provenance (%s)', (provenance) => {
      expect(
        isDepositRequired(signals({ scope, provenance, hasPriorRelationship: true })),
      ).toBe(true)
    })
  })

  // The safety property for every pro who never touched the setting: the
  // default must reproduce the pre-K10-A behaviour EXACTLY, so wiring the
  // setting up cannot silently start charging anyone new.
  describe('NEW_DISCOVERY_ONLY reproduces isNewDiscoveryClient exactly', () => {
    const BOOLS = [false, true]

    it('agrees across the whole signal matrix', () => {
      const disagreements: string[] = []

      for (const provenance of PROVENANCES) {
        for (const proDepositEnabled of BOOLS) {
          for (const proStripeReady of BOOLS) {
            for (const prior of BOOLS) {
              const scoped = isDepositRequired({
                scope: DepositScope.NEW_DISCOVERY_ONLY,
                proDepositEnabled,
                proStripeReady,
                provenance,
                hasPriorRelationship: prior,
              })

              const legacy = isNewDiscoveryClient({
                provenance,
                proDepositEnabled,
                proStripeReady,
                // Any one prior signal is enough; drive it through the booking count.
                establishedBookingCount: prior ? 1 : 0,
                acceptedInviteCount: 0,
                threadCount: 0,
                arrivedViaProNfc: false,
              })

              if (scoped !== legacy) {
                disagreements.push(
                  `${provenance} enabled=${proDepositEnabled} ready=${proStripeReady} prior=${prior}: scoped=${scoped} legacy=${legacy}`,
                )
              }
            }
          }
        }
      }

      expect(disagreements).toEqual([])
    })
  })
})
