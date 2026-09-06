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
    copy.chart,
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

  it('promotes the spotlight and chart rows rather than duplicating them', () => {
    // A promoted row is LIFTED out of clients/pros, never copied into both —
    // otherwise the page states a capability twice and the honest counts drift.
    const listed = [...copy.loop.steps, ...copy.clients.features, ...copy.pros.features].map(
      (f) => f.title,
    )
    for (const feature of [...copy.spotlight.features, copy.chart]) {
      expect(listed, feature.title).not.toContain(feature.title)
    }
    expect(copy.spotlight.features.length).toBe(2)
  })

  it('names no single beauty trade, because the page is for all of them', () => {
    // Tori, 2026-09-06: the product serves the whole beauty industry (nails,
    // lashes, brows, skin, makeup, barbering, hair), so homepage copy must not
    // read as a hair app. The words below each name ONE trade's vocabulary and
    // quietly exclude the rest; they slipped in three times before this test.
    //
    // "chair" is deliberately absent from this list: it is the brand's own
    // metaphor across the hero, the pros heading and the closer, and retiring
    // it is a branding decision rather than a copy fix.
    // 🔴 Matched on WORD BOUNDARIES, not substrings. A plain `toContain`
    // check fails on this very page: "chair" contains "hair", and "browse
    // looks without an account" contains "brow". A guard that flags the
    // brand's own metaphor gets deleted rather than obeyed.
    const singleTrade = [
      'hair',
      'stylist',
      'formula',
      'balayage',
      'blowout',
      'highlight',
      'barber',
      'manicure',
      'pedicure',
      'lash',
      'eyelash',
      'brow',
      'facial',
      'waxing',
    ]
    const rendered = JSON.stringify(copy, (key, value) =>
      key === 'evidence' ? undefined : value,
    )

    for (const word of singleTrade) {
      expect(
        rendered,
        `"${word}" names one trade; say it in a way that fits all of them`,
      ).not.toMatch(new RegExp(`\\b${word}s?\\b`, 'i'))
    }
  })

  it('claims only chart tabs that are not flag-gated', () => {
    // The chart band is `live`, and lib/clients/chartTabs.ts gates the
    // technical-record tab behind ENABLE_CLIENT_TECHNICAL_RECORD (off, with a
    // one-id founder allowlist, while the surface is legal-gated). Naming it
    // would promise a dark feature from a live row.
    const rendered = [copy.chart.body, copy.chart.aside, ...copy.chart.points.map((p) => p.body)]
      .join(' ')
      .toLowerCase()
    expect(rendered).not.toContain('technical record')
  })

  it('never tells a client that an explicit chart grant expires on its own', () => {
    // 🔴 The row this band replaced said "Share it with a new pro for 30 days,
    // then it closes on its own", welding two mechanisms together and getting
    // the reassuring half backwards. A BOOKING's access closes after
    // RECENT_COMPLETED_WINDOW_DAYS; a ClientChartShare GRANT is open-ended
    // (lib/clientVisibility.ts returns accessUntil: null for it) and ends only
    // when the client revokes. Overstating a privacy guarantee is the kind of
    // sentence someone relies on, so it gets a test rather than a comment.
    const rendered = [copy.chart.body, copy.chart.aside, ...copy.chart.points.map((p) => p.body)]
      .join(' ')
      .toLowerCase()

    // If the copy mentions a self-closing window, it must attribute it to the
    // booking, and it must still say the grant is revoked by hand.
    if (/closes (it|itself|on its own)|expires/.test(rendered)) {
      expect(rendered, 'a self-closing window must be attributed to the booking').toMatch(/booking/)
      expect(rendered, 'the grant must be described as revocable by the client').toMatch(
        /revoke|take it back|take that back/,
      )
    }
    // The word "share"/"grant" must never sit next to a day count.
    expect(rendered).not.toMatch(/(share|grant)[^.]{0,60}\b(thirty|30)\b/)
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
