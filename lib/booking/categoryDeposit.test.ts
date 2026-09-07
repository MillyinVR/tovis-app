// lib/booking/categoryDeposit.test.ts
//
// P7a-5. The property this suite is really defending is the FOURTH scenario in
// Tori's brief: "a pro with no settings → today's behaviour unchanged." That is
// asserted structurally — the overlay returns the account object itself — so it
// cannot be broken by a later branch that merely happens to agree today.

import { describe, expect, it } from 'vitest'

import { Prisma } from '@prisma/client'

import {
  categoryStatesDepositAmount,
  describeCategoryDepositBlocker,
  describeUpfrontChargeDisclosure,
  resolveEffectiveDepositSettings,
} from './categoryDeposit'
import type { DepositSettings } from './discoveryDepositPlan'
import type { DepositRequirement } from './depositRequirement'

const ACCOUNT_FLAT_40: DepositSettings = {
  depositEnabled: true,
  depositType: 'FLAT',
  depositFlatAmountCents: 4000,
  depositPercent: null,
}

const ACCOUNT_OFF: DepositSettings = {
  depositEnabled: false,
  depositType: 'FLAT',
  depositFlatAmountCents: null,
  depositPercent: null,
}

const gateOnlyRow = {
  bookingGate: 'AFTER_PREP' as const,
  depositType: null,
  depositFlatAmount: null,
  depositPercent: null,
}

const flat25Row = {
  bookingGate: 'INSTANT' as const,
  depositType: 'FLAT' as const,
  depositFlatAmount: new Prisma.Decimal('25.00'),
  depositPercent: null,
}

const percent20Row = {
  bookingGate: 'INSTANT' as const,
  depositType: 'PERCENT' as const,
  depositFlatAmount: null,
  depositPercent: 20,
}

describe('resolveEffectiveDepositSettings', () => {
  it('returns the account settings UNCHANGED when the pro has no category row', () => {
    // Identity, not deep equality: "today's behaviour unchanged" is a fact
    // about the object that reaches the money math, and an equal-but-rebuilt
    // object is one refactor away from not being equal any more.
    expect(resolveEffectiveDepositSettings({ account: ACCOUNT_FLAT_40, category: null }))
      .toBe(ACCOUNT_FLAT_40)
  })

  it('returns the account settings unchanged for a row that only sets the GATE', () => {
    // A pro can want "book after prep" on colour and keep her usual deposit.
    // The presence of a row is not the presence of a deposit override.
    expect(
      resolveEffectiveDepositSettings({ account: ACCOUNT_FLAT_40, category: gateOnlyRow }),
    ).toBe(ACCOUNT_FLAT_40)
  })

  it('replaces the amount with the category flat figure', () => {
    expect(
      resolveEffectiveDepositSettings({ account: ACCOUNT_FLAT_40, category: flat25Row }),
    ).toEqual({
      depositEnabled: true,
      depositType: 'FLAT',
      depositFlatAmountCents: 2500,
      depositPercent: null,
    })
  })

  it('switches type as well as amount, clearing the other column', () => {
    const effective = resolveEffectiveDepositSettings({
      account: ACCOUNT_FLAT_40,
      category: percent20Row,
    })
    expect(effective.depositType).toBe('PERCENT')
    expect(effective.depositPercent).toBe(20)
    // 🔴 The account's $40 must not survive as a stale flat amount beside a
    // PERCENT type — `computeDepositCents` branches on the type, so a leftover
    // would be invisible until someone flipped the type back.
    expect(effective.depositFlatAmountCents).toBeNull()
  })

  it('NEVER turns deposits on — the account switch is carried through', () => {
    // The single most important assertion here. A category amount changes HOW
    // MUCH, never WHETHER: `resolveDepositRequirement` reads `depositEnabled`,
    // and a category row that flipped it would start charging clients of a pro
    // who never turned deposits on.
    const effective = resolveEffectiveDepositSettings({
      account: ACCOUNT_OFF,
      category: flat25Row,
    })
    expect(effective.depositEnabled).toBe(false)
  })
})

describe('categoryStatesDepositAmount', () => {
  it('is false for no row and for a gate-only row', () => {
    expect(categoryStatesDepositAmount(null)).toBe(false)
    expect(categoryStatesDepositAmount(gateOnlyRow)).toBe(false)
  })

  it('is true once a type is set', () => {
    expect(categoryStatesDepositAmount(flat25Row)).toBe(true)
  })
})

describe('describeCategoryDepositBlocker', () => {
  it('refuses while the account switch is off, and names the fix', () => {
    const blocker = describeCategoryDepositBlocker({
      accountDepositEnabled: false,
      proStripeReady: true,
    })
    expect(blocker).toContain('payment settings')
  })

  it('refuses while Stripe is not ready', () => {
    expect(
      describeCategoryDepositBlocker({
        accountDepositEnabled: true,
        proStripeReady: false,
      }),
    ).toContain('Stripe')
  })

  it('allows when both are in place', () => {
    expect(
      describeCategoryDepositBlocker({
        accountDepositEnabled: true,
        proStripeReady: true,
      }),
    ).toBeNull()
  })
})

describe('describeUpfrontChargeDisclosure', () => {
  const NOTHING_OWED: DepositRequirement = {
    required: false,
    scopeRequired: false,
    prepayScope: null,
  }
  const SCOPE_DEPOSIT: DepositRequirement = {
    required: true,
    scopeRequired: true,
    prepayScope: null,
  }
  const PREPAY: DepositRequirement = {
    required: true,
    scopeRequired: false,
    prepayScope: 'SERVICE_ONLY',
  }

  it('says NOTHING when this booking owes nothing up front', () => {
    // The case that keeps the CTA and the charge honest: a pro can have a $40
    // deposit configured and still take none from THIS client (default
    // NEW_DISCOVERY_ONLY scope, returning client). The disclosure follows the
    // requirement, not the configuration.
    expect(
      describeUpfrontChargeDisclosure({
        requirement: NOTHING_OWED,
        settings: ACCOUNT_FLAT_40,
      }),
    ).toBeNull()
  })

  it('reports a flat deposit in cents', () => {
    expect(
      describeUpfrontChargeDisclosure({
        requirement: SCOPE_DEPOSIT,
        settings: { ...ACCOUNT_FLAT_40, depositFlatAmountCents: 2500 },
      }),
    ).toEqual({ kind: 'FLAT', amountCents: 2500 })
  })

  it('reports a percentage deposit as a PERCENTAGE, never as dollars', () => {
    expect(
      describeUpfrontChargeDisclosure({
        requirement: SCOPE_DEPOSIT,
        settings: {
          depositEnabled: true,
          depositType: 'PERCENT',
          depositFlatAmountCents: null,
          depositPercent: 20,
        },
      }),
    ).toEqual({ kind: 'PERCENT', percent: 20 })
  })

  it('reports PREPAY rather than a deposit when the service demands the whole price', () => {
    // Calling a 100% prepay "a deposit" would understate the tap by the entire
    // bill — the single most expensive thing this sentence could get wrong.
    expect(
      describeUpfrontChargeDisclosure({ requirement: PREPAY, settings: ACCOUNT_FLAT_40 }),
    ).toEqual({ kind: 'PREPAY' })
  })

  it('says nothing for a configured-but-zero amount', () => {
    expect(
      describeUpfrontChargeDisclosure({
        requirement: SCOPE_DEPOSIT,
        settings: { ...ACCOUNT_FLAT_40, depositFlatAmountCents: 0 },
      }),
    ).toBeNull()
  })
})
