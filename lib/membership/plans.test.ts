import { describe, it, expect } from 'vitest'

import { CAMERA_IMAGES_PER_MONTH } from '@/lib/pro/entitlements'
import {
  getMembershipPlan,
  getMembershipPlans,
  getPurchasablePrice,
} from './plans'

describe('membership plan catalog', () => {
  it('lists free, pro, premium and the Studio enterprise card', () => {
    expect(getMembershipPlans().map((p) => p.key)).toEqual([
      'free',
      'pro',
      'premium',
      'studio',
    ])
  })

  it('shows the camera ladder Tori signed off: 10 / 150 / 500', () => {
    const byKey = Object.fromEntries(
      getMembershipPlans().map((p) => [p.key, p.cameraImagesPerMonth]),
    )
    expect(byKey).toMatchObject({ free: 10, pro: 150, premium: 500, studio: 500 })
    // The card must never drift from the entitlement matrix that enforces it.
    for (const plan of getMembershipPlans()) {
      expect(plan.cameraImagesPerMonth).toBe(CAMERA_IMAGES_PER_MONTH[plan.key])
    }
  })

  it('prices Pro at $25/$240 and Premium at $45/$432 (FINAL, 2026-08-04)', () => {
    const amounts = (key: string) =>
      Object.fromEntries(
        (getMembershipPlan(key)?.prices ?? []).map((p) => [p.interval, p.amountCents]),
      )
    expect(amounts('pro')).toEqual({ month: 2500, year: 24000 })
    expect(amounts('premium')).toEqual({ month: 4500, year: 43200 })
  })
})

describe('Studio is an enterprise tier, not a product', () => {
  const studio = getMembershipPlan('studio')

  it('is contact-only with no prices at all', () => {
    expect(studio?.acquisition).toBe('contact')
    expect(studio?.prices).toEqual([])
    expect(studio?.trialDays).toBe(0)
  })

  // 🔴 The refusal must be the RULE, not a side effect of an unconfigured env var.
  // Studio is salon-only with a minimum-pro-count purchase gate that does not exist
  // yet, so it must be un-purchasable even if a price id somehow appears.
  it('can never be checked out, for either interval', () => {
    expect(getPurchasablePrice('studio', 'month')).toBeNull()
    expect(getPurchasablePrice('studio', 'year')).toBeNull()
  })

  it('free is likewise never purchasable', () => {
    expect(getPurchasablePrice('free', 'month')).toBeNull()
  })

  // 🔴 The copy rule this whole change exists to enforce: an enterprise card must
  // not name a feature that has no implementation. white-label is the specific one
  // that was being advertised with zero call sites anywhere in either repo.
  it('never names an unbuilt feature in its customer-facing copy', () => {
    const copy = `${studio?.name} ${studio?.blurb}`.toLowerCase()
    expect(copy).not.toContain('white label')
    expect(copy).not.toContain('white-label')
  })
})

describe('advertised plan copy stays honest', () => {
  // The discovery-fee waiver as CODED zeroes the client's fee, which is not the
  // intended perk (the intended one waives a pro-side fee that does not exist yet).
  // It must not be sold on any plan card until that fee ships and is measured.
  it('no plan blurb advertises the discovery-fee waiver', () => {
    for (const plan of getMembershipPlans()) {
      expect(plan.blurb.toLowerCase()).not.toContain('discovery fee')
      expect(plan.blurb.toLowerCase()).not.toContain('no platform fee')
    }
  })

  it('no plan blurb promises an unshipped feature', () => {
    for (const plan of getMembershipPlans()) {
      // "when they ship" / "coming soon" are the tells that a card is selling
      // something that does not exist. Premium carried exactly that for months.
      expect(plan.blurb.toLowerCase()).not.toContain('when they ship')
      expect(plan.blurb.toLowerCase()).not.toContain('coming soon')
    }
  })
})
