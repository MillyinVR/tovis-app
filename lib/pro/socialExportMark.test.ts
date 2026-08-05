import { describe, it, expect } from 'vitest'
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

describe('exportsDropPlatformMark — enforcement ON', () => {
  // 🔴 Both directions, every tier. This is the whole member perk: get either
  // direction wrong and either a paying pro's exports carry a mark they paid to
  // remove, or the mark never ships at all and the perk is a lie on the pricing
  // page. Neither failure is visible anywhere else in this repo — the render is on
  // the device.
  it('free pros keep the Tovis mark', () => {
    expect(exportsDropPlatformMark(FREE, true)).toBe(false)
  })

  it('every paid tier drops the Tovis mark', () => {
    expect(exportsDropPlatformMark(PRO, true)).toBe(true)
    expect(exportsDropPlatformMark(PREMIUM, true)).toBe(true)
    expect(exportsDropPlatformMark(STUDIO, true)).toBe(true)
  })

  it('a lapsed paid plan is back to the mark (collapses to free)', () => {
    for (const status of [
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.INCOMPLETE,
    ]) {
      const ents = resolveEntitlements({ planKey: 'premium', status })
      expect(exportsDropPlatformMark(ents, true)).toBe(false)
    }
  })

  it('a trialing pro is a member — the trial must not ship a marked export', () => {
    const ents = resolveEntitlements({
      planKey: 'pro',
      status: SubscriptionStatus.TRIALING,
    })
    expect(exportsDropPlatformMark(ents, true)).toBe(true)
  })

  it('reads the entitlement itself, not the plan key', () => {
    expect(exportsDropPlatformMark([SOCIAL_EXPORT_UNBRANDED], true)).toBe(true)
    expect(exportsDropPlatformMark(['tax_export'], true)).toBe(false)
  })
})

describe('exportsDropPlatformMark — enforcement OFF (production today)', () => {
  // 🔴 The honest statement of what ships right now. Every other paid gate in the
  // repo resolves as granted while the master switch is off, and this follows them.
  // Pinned as a test so the behaviour is a decision on the record rather than an
  // accident someone "fixes" later without noticing they changed what free pros get.
  it('grants everybody the unbranded export — free and paid render identically', () => {
    expect(exportsDropPlatformMark(FREE, false)).toBe(true)
    expect(exportsDropPlatformMark(PRO, false)).toBe(true)
    expect(exportsDropPlatformMark([], false)).toBe(true)
  })
})

describe('the flag is what changes the answer', () => {
  it('a free pro flips from unbranded to marked the moment enforcement turns on', () => {
    expect(exportsDropPlatformMark(FREE, false)).toBe(true)
    expect(exportsDropPlatformMark(FREE, true)).toBe(false)
  })

  it('a paying pro is unbranded either way — the flag never costs a member', () => {
    expect(exportsDropPlatformMark(PRO, false)).toBe(true)
    expect(exportsDropPlatformMark(PRO, true)).toBe(true)
  })
})
