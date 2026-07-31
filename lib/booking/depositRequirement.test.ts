import { describe, expect, it } from 'vitest'
import {
  BookingDiscoveryProvenance,
  DepositScope,
  OfferingPrepayScope,
} from '@prisma/client'

import {
  resolveDepositRequirement,
  type DepositRequirementSignals,
} from '@/lib/booking/depositRequirement'
import { isNewDiscoveryClient } from '@/lib/booking/discoveryFee'

const PROVENANCES = Object.values(BookingDiscoveryProvenance)
const PREPAY_SCOPES = Object.values(OfferingPrepayScope)

function signals(
  overrides: Partial<DepositRequirementSignals> = {},
): DepositRequirementSignals {
  return {
    scope: DepositScope.NEW_DISCOVERY_ONLY,
    proDepositEnabled: true,
    proStripeReady: true,
    provenance: BookingDiscoveryProvenance.LOOKS_FEED,
    hasPriorRelationship: false,
    offeringPrepayScope: null,
    // K16 defaults = no per-client policy, which is every existing (pro, client)
    // pair. The whole K10 matrix below therefore still asserts pre-K16
    // behaviour, unchanged.
    clientPolicyRequiresDeposit: false,
    clientPolicyPrepayScope: null,
    ...overrides,
  }
}

/** The gate every caller branches on. */
function isRequired(overrides: Partial<DepositRequirementSignals> = {}): boolean {
  return resolveDepositRequirement(signals(overrides)).required
}

describe('resolveDepositRequirement', () => {
  describe('gates that apply whatever the scope', () => {
    it.each(Object.values(DepositScope))(
      'refuses a pro with deposits switched off (%s)',
      (scope) => {
        expect(isRequired({ scope, proDepositEnabled: false })).toBe(false)
      },
    )

    // Requiring a deposit a pro cannot receive would strand the booking PENDING
    // with no way to pay it.
    it.each(Object.values(DepositScope))(
      'refuses a pro who cannot take a destination charge (%s)',
      (scope) => {
        expect(isRequired({ scope, proStripeReady: false })).toBe(false)
      },
    )
  })

  describe('NEW_DISCOVERY_ONLY — the default', () => {
    const scope = DepositScope.NEW_DISCOVERY_ONLY

    it('requires a deposit from a new client found via the Looks feed', () => {
      expect(isRequired({ scope })).toBe(true)
    })

    it('requires a deposit from a new client found via Discovery search', () => {
      expect(
        isRequired({
          scope,
          provenance: BookingDiscoveryProvenance.DISCOVERY_SEARCH,
        }),
      ).toBe(true)
    })

    it('exempts a returning client', () => {
      expect(isRequired({ scope, hasPriorRelationship: true })).toBe(false)
    })

    it.each(
      PROVENANCES.filter(
        (p) =>
          p !== BookingDiscoveryProvenance.LOOKS_FEED &&
          p !== BookingDiscoveryProvenance.DISCOVERY_SEARCH,
      ),
    )('exempts a new client who arrived some other way (%s)', (provenance) => {
      expect(isRequired({ scope, provenance })).toBe(false)
    })
  })

  describe('ALL_NEW_CLIENTS', () => {
    const scope = DepositScope.ALL_NEW_CLIENTS

    // The whole point of the setting: a first-timer who searched the pro by
    // name owes a deposit, where NEW_DISCOVERY_ONLY would have exempted them.
    it.each(PROVENANCES)(
      'requires a deposit from any first-time client, however they arrived (%s)',
      (provenance) => {
        expect(isRequired({ scope, provenance })).toBe(true)
      },
    )

    it('exempts a returning client', () => {
      expect(isRequired({ scope, hasPriorRelationship: true })).toBe(false)
    })
  })

  describe('ALL_CLIENTS', () => {
    const scope = DepositScope.ALL_CLIENTS

    it('requires a deposit from a returning client too', () => {
      expect(isRequired({ scope, hasPriorRelationship: true })).toBe(true)
    })

    it.each(PROVENANCES)('requires a deposit whatever the provenance (%s)', (provenance) => {
      expect(isRequired({ scope, provenance, hasPriorRelationship: true })).toBe(true)
    })
  })

  // K10 (D4): the per-service requirement. Tori, 2026-07-30 — per-service
  // prepay OVERRIDES the account-wide switch.
  describe('per-service prepay (K10)', () => {
    it.each(PREPAY_SCOPES)(
      'requires an up-front charge even with deposits switched OFF account-wide (%s)',
      (offeringPrepayScope) => {
        const decision = resolveDepositRequirement(
          signals({ proDepositEnabled: false, offeringPrepayScope }),
        )

        expect(decision.required).toBe(true)
        // ...but the pro's own deposit rule did NOT fire, so nothing may size an
        // ordinary flat/percent deposit on top of the prepay.
        expect(decision.scopeRequired).toBe(false)
        expect(decision.prepayScope).toBe(offeringPrepayScope)
      },
    )

    it.each(PREPAY_SCOPES)(
      'requires an up-front charge from a RETURNING client the scope exempts (%s)',
      (offeringPrepayScope) => {
        const decision = resolveDepositRequirement(
          signals({
            scope: DepositScope.NEW_DISCOVERY_ONLY,
            hasPriorRelationship: true,
            provenance: BookingDiscoveryProvenance.NAME_SEARCH,
            offeringPrepayScope,
          }),
        )

        expect(decision.required).toBe(true)
        expect(decision.scopeRequired).toBe(false)
      },
    )

    // 🔴 The one gate prepay does NOT override: a pro who cannot receive a
    // destination charge. A prepay requirement they cannot collect on is worse
    // than none at all — it strands the booking with a bill nobody can pay.
    it.each(PREPAY_SCOPES)(
      'still refuses a pro who cannot take a destination charge (%s)',
      (offeringPrepayScope) => {
        const decision = resolveDepositRequirement(
          signals({ proStripeReady: false, offeringPrepayScope }),
        )

        expect(decision.required).toBe(false)
        expect(decision.prepayScope).toBeNull()
      },
    )

    it('reports BOTH reasons when the scope also calls for a deposit', () => {
      const decision = resolveDepositRequirement(
        signals({
          scope: DepositScope.ALL_CLIENTS,
          hasPriorRelationship: true,
          offeringPrepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
        }),
      )

      expect(decision).toEqual({
        required: true,
        scopeRequired: true,
        prepayScope: OfferingPrepayScope.ENTIRE_BOOKING,
      })
    })

    it('leaves an unmarked service alone', () => {
      const decision = resolveDepositRequirement(
        signals({ offeringPrepayScope: null }),
      )

      expect(decision.prepayScope).toBeNull()
      expect(decision.required).toBe(decision.scopeRequired)
    })
  })

  // The safety property for every pro who never touched the setting: the
  // default must reproduce the pre-K10-A behaviour EXACTLY, so wiring the
  // setting up cannot silently start charging anyone new. K10 keeps it: an
  // offering with no prepay requirement must still agree with the legacy gate.
  describe('NEW_DISCOVERY_ONLY + no prepay reproduces isNewDiscoveryClient exactly', () => {
    const BOOLS = [false, true]

    it('agrees across the whole signal matrix', () => {
      const disagreements: string[] = []

      for (const provenance of PROVENANCES) {
        for (const proDepositEnabled of BOOLS) {
          for (const proStripeReady of BOOLS) {
            for (const prior of BOOLS) {
              const scoped = resolveDepositRequirement({
                scope: DepositScope.NEW_DISCOVERY_ONLY,
                proDepositEnabled,
                proStripeReady,
                provenance,
                hasPriorRelationship: prior,
                offeringPrepayScope: null,
                clientPolicyRequiresDeposit: false,
                clientPolicyPrepayScope: null,
              }).required

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
