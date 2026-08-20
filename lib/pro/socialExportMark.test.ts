import { afterEach, describe, it, expect } from 'vitest'
import { SubscriptionStatus } from '@prisma/client'

import { resolveEntitlements } from '@/lib/pro/entitlements'
import {
  SOCIAL_EXPORT_UNBRANDED,
  exportsDropPlatformMark,
} from '@/lib/pro/socialExportMark'

const FREE = resolveEntitlements({ planKey: 'free', status: SubscriptionStatus.ACTIVE })
const PRO = resolveEntitlements({ planKey: 'pro', status: SubscriptionStatus.ACTIVE })
const PREMIUM = resolveEntitlements({
  planKey: 'premium',
  status: SubscriptionStatus.ACTIVE,
})
const STUDIO = resolveEntitlements({
  planKey: 'studio',
  status: SubscriptionStatus.ACTIVE,
})

describe('exportsDropPlatformMark', () => {
  // 🔴 Both directions, every tier. This is the whole member perk: get either
  // direction wrong and either a paying pro's exports carry a mark they paid to
  // remove, or the mark never ships at all and the perk is a lie on the pricing
  // page. Neither failure is visible anywhere else in this repo — the render is on
  // the device.
  it('free pros keep the platform mark', () => {
    expect(exportsDropPlatformMark(FREE)).toBe(false)
  })

  it('every paid tier drops the platform mark', () => {
    expect(exportsDropPlatformMark(PRO)).toBe(true)
    expect(exportsDropPlatformMark(PREMIUM)).toBe(true)
    expect(exportsDropPlatformMark(STUDIO)).toBe(true)
  })

  it('a lapsed paid plan is back to the mark (collapses to free)', () => {
    for (const status of [
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.INCOMPLETE,
    ]) {
      const ents = resolveEntitlements({ planKey: 'premium', status })
      expect(exportsDropPlatformMark(ents)).toBe(false)
    }
  })

  it('a trialing pro is a member — the trial must not ship a marked export', () => {
    const ents = resolveEntitlements({
      planKey: 'pro',
      status: SubscriptionStatus.TRIALING,
    })
    expect(exportsDropPlatformMark(ents)).toBe(true)
  })

  it('reads the entitlement itself, not the plan key', () => {
    expect(exportsDropPlatformMark([SOCIAL_EXPORT_UNBRANDED])).toBe(true)
    expect(exportsDropPlatformMark(['tax_export'])).toBe(false)
  })
})

describe('the enforcement flag must NOT change the answer', () => {
  // 🔴 This is the regression guard for the 2026-08-20 decision, and it is the
  // only thing standing between the current behaviour and a well-meaning revert.
  //
  // This gate used to short-circuit to `true` whenever ENABLE_MEMBERSHIP_ENFORCEMENT
  // was off — i.e. free and paying pros exported identically until the master switch
  // flipped. Tori settled it the other way: the platform mark is marketing, so it
  // ships on free pros' exports NOW, independent of the switch. Every other paid
  // gate in the repo still follows the switch, which makes this the one deliberate
  // exception — and therefore the one most likely to be "fixed" back into line by
  // someone restoring consistency without reading the header.
  //
  // Asserted by driving the real env var, not by passing a parameter: the parameter
  // was deliberately removed so no call site can reintroduce the short-circuit.
  const original = process.env.ENABLE_MEMBERSHIP_ENFORCEMENT

  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_MEMBERSHIP_ENFORCEMENT
    else process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = original
  })

  for (const flag of ['1', 'true', 'yes', '0', 'false', ''] as const) {
    it(`is identical with ENABLE_MEMBERSHIP_ENFORCEMENT=${JSON.stringify(flag)}`, () => {
      process.env.ENABLE_MEMBERSHIP_ENFORCEMENT = flag
      expect(exportsDropPlatformMark(FREE)).toBe(false)
      expect(exportsDropPlatformMark(PRO)).toBe(true)
    })
  }

  it('is identical with the flag entirely unset (production today)', () => {
    delete process.env.ENABLE_MEMBERSHIP_ENFORCEMENT
    expect(exportsDropPlatformMark(FREE)).toBe(false)
    expect(exportsDropPlatformMark(PRO)).toBe(true)
    expect(exportsDropPlatformMark([])).toBe(false)
  })
})
