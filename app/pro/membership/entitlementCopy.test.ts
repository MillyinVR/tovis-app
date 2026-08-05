import { describe, it, expect } from 'vitest'
import { SubscriptionStatus } from '@prisma/client'

import { resolveEntitlements } from '@/lib/pro/entitlements'
import { advertisedEntitlements } from './entitlementCopy'

describe('advertisedEntitlements', () => {
  it('labels every entitlement a PAYING plan grants — no silent blanks', () => {
    for (const planKey of ['pro', 'premium']) {
      const granted = resolveEntitlements({
        planKey,
        status: SubscriptionStatus.ACTIVE,
      })
      const advertised = advertisedEntitlements(granted)

      // Everything named must be implemented AND something we intend to sell.
      // advanced_analytics qualifies (lib/analytics/proRetentionInsights.ts).
      expect(advertised.map((a) => a.key)).toContain('advanced_analytics')
      expect(advertised.map((a) => a.key)).toContain('tax_export')
      for (const item of advertised) {
        expect(granted).toContain(item.key)
      }

      // 🔴 discovery_fee_waiver is granted but deliberately NOT advertised: as
      // coded it waives the CLIENT's fee, while the intended perk waives a
      // pro-side fee that does not exist yet (brief §8.5). Selling it today would
      // describe a benefit the pro does not actually receive.
      expect(granted).toContain('discovery_fee_waiver')
      expect(advertised.map((a) => a.key)).not.toContain('discovery_fee_waiver')
      for (const item of advertised) {
        expect(item.label.trim().length).toBeGreaterThan(0)
      }
    }
  })

  // 🔴 The load-bearing one. `white_label` has no implementation call site and
  // Studio is comp-only, so a comped salon partner must NOT be shown a checkmark
  // claiming they have it. Dropping unlabeled keys (rather than title-casing them,
  // which is what iOS used to do) is what makes that true.
  it('drops an entitlement we deliberately do not advertise (white_label)', () => {
    // Product rule (Tori, 2026-08-04): white-label is a SALON-only offering with a
    // minimum-pro-count purchase gate, so it must never surface as a self-serve
    // line item on an individual pro's membership page.
    const studio = resolveEntitlements({
      planKey: 'studio',
      status: SubscriptionStatus.ACTIVE,
    })
    expect(studio).toContain('white_label')

    const advertised = advertisedEntitlements(studio)
    expect(advertised.map((a) => a.key)).not.toContain('white_label')
    // ...while still showing the real ones a Studio comp does get.
    expect(advertised.map((a) => a.key)).toContain('tax_export')
  })

  it('a free plan advertises nothing', () => {
    expect(advertisedEntitlements([])).toEqual([])
  })
})
