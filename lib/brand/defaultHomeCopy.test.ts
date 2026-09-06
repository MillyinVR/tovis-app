// lib/brand/defaultHomeCopy.test.ts
//
// The homepage is checkable marketing. These tests pin the SHAPE of that
// promise: two states only, evidence on every row, a real verification date,
// and no brand name baked in. They cannot check that a row is TRUE — that is
// the `evidence` line's job, re-done by hand on every `verifiedOn` bump.
import { describe, expect, it } from 'vitest'

import { defaultHomeCopy } from './defaultHomeCopy'
import type { BrandHomeFeature } from './types'

const copy = defaultHomeCopy('ACME')

function everyFeature(): BrandHomeFeature[] {
  return [
    ...copy.loop.steps,
    ...copy.clients.features,
    ...copy.spotlight.features,
    ...copy.pros.features,
    copy.money,
  ]
}

describe('defaultHomeCopy', () => {
  it('uses exactly the two allowed states at runtime, not just in the type', () => {
    const allowed = new Set(['live', 'rolling-out'])
    for (const feature of everyFeature()) {
      expect(allowed.has(feature.state), `${feature.title}: ${feature.state}`).toBe(true)
    }
  })

  it('carries evidence on every row — a claim with no receipt does not ship', () => {
    for (const feature of everyFeature()) {
      expect(feature.evidence.trim().length, feature.title).toBeGreaterThan(40)
    }
  })

  it('names a date on every rolling-out row so a stale caveat is visible', () => {
    for (const feature of everyFeature().filter((f) => f.state === 'rolling-out')) {
      expect(feature.evidence, feature.title).toMatch(/20\d\d-\d\d(-\d\d)?|build \d+/)
    }
  })

  it('has a verification date in ISO form and as prose', () => {
    expect(copy.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(copy.verifiedOnLabel.trim().length).toBeGreaterThan(0)
    // Prose and ISO name the same year, so one cannot be bumped without the other.
    expect(copy.verifiedOnLabel).toContain(copy.verifiedOn.slice(0, 4))
  })

  it('never repeats a feature title', () => {
    const titles = everyFeature().map((f) => f.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('bakes in the wordmark it was given and no other brand into RENDERED copy', () => {
    // `evidence` is never rendered and legitimately names repo paths and
    // sibling repos, so it is stripped before the white-label check.
    const rendered = JSON.stringify(copy, (key, value) => (key === 'evidence' ? undefined : value))
    expect(rendered).toContain('ACME')
    expect(rendered).not.toMatch(/tovis/i)
  })

  it('counts the tools it claims to replace honestly and carries a receipt for the claim', () => {
    expect(copy.replaces.items.length).toBeLessThanOrEqual(6)
    expect(copy.replaces.title).toContain(String(copy.replaces.items.length === 6 ? 'Six' : ''))
    expect(copy.replaces.evidence.trim().length).toBeGreaterThan(40)
  })

  it('keeps em dashes out of rendered copy', () => {
    const rendered = JSON.stringify(copy, (key, value) => (key === 'evidence' ? undefined : value))
    expect(rendered).not.toContain('—')
  })

  it('has at least one rolling-out row — the page is honest, not a brochure', () => {
    expect(everyFeature().some((f) => f.state === 'rolling-out')).toBe(true)
  })

  it('promotes spotlight rows rather than duplicating them', () => {
    // A spotlight row is LIFTED out of clients/pros, never copied into both —
    // otherwise the page states a capability twice and the honest counts drift.
    const listed = [...copy.loop.steps, ...copy.clients.features, ...copy.pros.features].map(
      (f) => f.title,
    )
    for (const feature of copy.spotlight.features) {
      expect(listed, feature.title).not.toContain(feature.title)
    }
    expect(copy.spotlight.features.length).toBe(2)
  })

  it('makes a rolling-out spotlight name its limit in a chip, not only in the pill', () => {
    // Chips are the smallest rendered copy on the page and sit under the
    // loudest section. A caveat carried only by the state pill is one glance
    // away from being missed, so the last chip has to carry it too.
    for (const feature of copy.spotlight.features) {
      expect(feature.chips.length, feature.title).toBeGreaterThan(0)
      if (feature.state !== 'rolling-out') continue
      expect(feature.chips.at(-1), feature.title).toMatch(/beta|pilot|soon|test|invite/i)
    }
  })
})
