import { describe, expect, it } from 'vitest'
import { DepositType, OfferingPrepayScope } from '@prisma/client'

import {
  describeCardOnFileRequirementBlocker,
  describeDepositRequirementBlocker,
  describePrepayRequirementBlocker,
  hasUsableDepositConfiguration,
  resolveProClientPolicy,
  widerPrepayScope,
  type ProClientPolicyRow,
} from '@/lib/proClientPolicy/policy'
import { getBookingErrorDescriptor } from '@/lib/booking/errors'

function row(overrides: Partial<ProClientPolicyRow> = {}): ProClientPolicyRow {
  return {
    requireDeposit: false,
    prepayScope: null,
    requireCardOnFile: false,
    blockSelfServeBooking: false,
    ...overrides,
  }
}

describe('resolveProClientPolicy', () => {
  it('resolves every default when the pro has set nothing', () => {
    const resolved = resolveProClientPolicy({
      policy: null,
      cardOnFileRailEnabled: true,
    })

    expect(resolved).toEqual({
      requiresDeposit: false,
      prepayScope: null,
      requiresCardOnFile: false,
      blocksSelfServeBooking: false,
      anyRequirement: false,
    })
  })

  it('passes through the switches the pro set', () => {
    const resolved = resolveProClientPolicy({
      policy: row({
        requireDeposit: true,
        prepayScope: OfferingPrepayScope.SERVICE_ONLY,
        blockSelfServeBooking: true,
      }),
      cardOnFileRailEnabled: true,
    })

    expect(resolved.requiresDeposit).toBe(true)
    expect(resolved.prepayScope).toBe(OfferingPrepayScope.SERVICE_ONLY)
    expect(resolved.blocksSelfServeBooking).toBe(true)
    expect(resolved.anyRequirement).toBe(true)
  })

  // 🔴 The gate that stops a client being asked for something no client can do.
  it('drops a card-on-file requirement while the save-card rail is dark', () => {
    const stored = row({ requireCardOnFile: true })

    expect(
      resolveProClientPolicy({ policy: stored, cardOnFileRailEnabled: false })
        .requiresCardOnFile,
    ).toBe(false)

    expect(
      resolveProClientPolicy({ policy: stored, cardOnFileRailEnabled: true })
        .requiresCardOnFile,
    ).toBe(true)
  })

  it('does not report a requirement when the only switch set is rail-gated off', () => {
    const resolved = resolveProClientPolicy({
      policy: row({ requireCardOnFile: true }),
      cardOnFileRailEnabled: false,
    })

    // anyRequirement drives the pro's "requirements set" mark. Claiming one is
    // active while it resolves to nothing is the same lie in the other direction.
    expect(resolved.anyRequirement).toBe(false)
  })

  it('leaves the OTHER switches alone when the card rail is dark', () => {
    const resolved = resolveProClientPolicy({
      policy: row({ requireCardOnFile: true, blockSelfServeBooking: true }),
      cardOnFileRailEnabled: false,
    })

    expect(resolved.requiresCardOnFile).toBe(false)
    expect(resolved.blocksSelfServeBooking).toBe(true)
    expect(resolved.anyRequirement).toBe(true)
  })
})

describe('widerPrepayScope', () => {
  it('returns null only when neither side requires prepay', () => {
    expect(widerPrepayScope(null, null)).toBeNull()
  })

  it('takes the non-null side', () => {
    expect(widerPrepayScope(null, OfferingPrepayScope.SERVICE_ONLY)).toBe(
      OfferingPrepayScope.SERVICE_ONLY,
    )
    expect(widerPrepayScope(OfferingPrepayScope.SERVICE_ONLY, null)).toBe(
      OfferingPrepayScope.SERVICE_ONLY,
    )
  })

  it('ENTIRE_BOOKING wins from either side', () => {
    expect(
      widerPrepayScope(
        OfferingPrepayScope.SERVICE_ONLY,
        OfferingPrepayScope.ENTIRE_BOOKING,
      ),
    ).toBe(OfferingPrepayScope.ENTIRE_BOOKING)

    expect(
      widerPrepayScope(
        OfferingPrepayScope.ENTIRE_BOOKING,
        OfferingPrepayScope.SERVICE_ONLY,
      ),
    ).toBe(OfferingPrepayScope.ENTIRE_BOOKING)
  })

  it('is commutative across every pair', () => {
    const values = [null, ...Object.values(OfferingPrepayScope)] as const

    for (const left of values) {
      for (const right of values) {
        expect(widerPrepayScope(left, right)).toBe(widerPrepayScope(right, left))
      }
    }
  })
})

describe('hasUsableDepositConfiguration', () => {
  it('is false when the pro has deposits switched off', () => {
    expect(
      hasUsableDepositConfiguration({
        depositEnabled: false,
        depositType: DepositType.FLAT,
        depositFlatAmountCents: 5000,
        depositPercent: null,
      }),
    ).toBe(false)
  })

  it('is false for a flat deposit of zero or none', () => {
    for (const cents of [null, 0]) {
      expect(
        hasUsableDepositConfiguration({
          depositEnabled: true,
          depositType: DepositType.FLAT,
          depositFlatAmountCents: cents,
          depositPercent: null,
        }),
      ).toBe(false)
    }
  })

  it('is false for a 0% deposit', () => {
    expect(
      hasUsableDepositConfiguration({
        depositEnabled: true,
        depositType: DepositType.PERCENT,
        depositFlatAmountCents: null,
        depositPercent: 0,
      }),
    ).toBe(false)
  })

  // A PERCENT rule is usable without knowing the bill — that is the whole
  // reason this asks about the configuration and not about an amount.
  it('is true for a percentage, with no price in sight', () => {
    expect(
      hasUsableDepositConfiguration({
        depositEnabled: true,
        depositType: DepositType.PERCENT,
        depositFlatAmountCents: null,
        depositPercent: 20,
      }),
    ).toBe(true)
  })
})

describe('requirement blockers', () => {
  it('refuses a deposit requirement when payments are not connected', () => {
    expect(
      describeDepositRequirementBlocker({
        proStripeReady: false,
        hasUsableDepositConfiguration: true,
      }),
    ).toMatch(/connecting payments/i)
  })

  it('refuses a deposit requirement that would ask for $0', () => {
    expect(
      describeDepositRequirementBlocker({
        proStripeReady: true,
        hasUsableDepositConfiguration: false,
      }),
    ).toMatch(/\$0/)
  })

  it('allows a deposit requirement a pro can actually collect', () => {
    expect(
      describeDepositRequirementBlocker({
        proStripeReady: true,
        hasUsableDepositConfiguration: true,
      }),
    ).toBeNull()
  })

  // The asymmetry: prepay sizes itself from the bill, so an unconfigured
  // deposit is irrelevant to it. Only Stripe readiness binds.
  it('blocks prepay on Stripe readiness alone', () => {
    expect(describePrepayRequirementBlocker({ proStripeReady: false })).toMatch(
      /connecting payments/i,
    )
    expect(describePrepayRequirementBlocker({ proStripeReady: true })).toBeNull()
  })

  it('blocks a card-on-file requirement while the rail is dark', () => {
    expect(
      describeCardOnFileRequirementBlocker({ cardOnFileRailEnabled: false }),
    ).toBeTruthy()
    expect(
      describeCardOnFileRequirementBlocker({ cardOnFileRailEnabled: true }),
    ).toBeNull()
  })
})

// 🔴 The policy is pro-private. A client feels its effect but must never be told
// that a professional set something about them, so the refusal copy on the
// client's path may not characterise them or reveal that a policy exists.
describe('client-facing refusal copy stays neutral', () => {
  const CLIENT_FACING_CODES = [
    'SELF_SERVE_BOOKING_UNAVAILABLE',
    'CARD_ON_FILE_REQUIRED',
  ] as const

  const FORBIDDEN = [
    'flag',
    'flagged',
    'restrict',
    'restricted',
    'blocked',
    'banned',
    'barred',
    'refused',
    'policy about you',
    'do not rebook',
    'difficult',
  ]

  it.each(CLIENT_FACING_CODES)(
    '%s says nothing about the person',
    (code) => {
      const { userMessage } = getBookingErrorDescriptor(code)
      const lowered = userMessage.toLowerCase()

      for (const word of FORBIDDEN) {
        expect(
          lowered.includes(word),
          `userMessage for ${code} must not contain "${word}": ${userMessage}`,
        ).toBe(false)
      }
    },
  )

  it('tells a blocked client what to do instead of just refusing', () => {
    const { userMessage, uiAction } = getBookingErrorDescriptor(
      'SELF_SERVE_BOOKING_UNAVAILABLE',
    )

    expect(uiAction).toBe('CONTACT_PRO')
    // Sending them round the availability grid to hit the same wall on every
    // slot would be the failure this copy exists to avoid.
    expect(userMessage.toLowerCase()).toMatch(/message this pro|contact/i)
  })

  it('marks the card requirement retryable — saving a card really clears it', () => {
    const descriptor = getBookingErrorDescriptor('CARD_ON_FILE_REQUIRED')

    expect(descriptor.retryable).toBe(true)
    expect(descriptor.uiAction).toBe('ADD_PAYMENT_METHOD')
    expect(descriptor.userMessage.toLowerCase()).toContain('won’t be charged')
  })
})
