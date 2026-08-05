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

      // Everything Pro/Premium grants is implemented AND sellable, so the page
      // must name all of it. A gap here means either a missing label or an
      // entitlement that slipped into a paid plan without copy.
      expect(advertised.map((a) => a.key)).toEqual(granted)
      // ...including advanced_analytics, which is only allowed back on a paid
      // plan because lib/analytics/proRetentionInsights.ts now implements it.
      expect(advertised.map((a) => a.key)).toContain('advanced_analytics')
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
