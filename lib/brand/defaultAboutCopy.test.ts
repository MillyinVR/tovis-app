// lib/brand/defaultAboutCopy.test.ts
//
// Pins the SHAPE of the About copy: the brand name comes from the caller and
// nothing else is baked in, the voice rules hold (no em dashes), and the two
// limits the homepage states for rolling-out features are stated here too, so
// this page cannot quietly promise more than the checkable one does.
import { describe, expect, it } from 'vitest'

import { defaultAboutCopy } from './defaultAboutCopy'

const copy = defaultAboutCopy('ACME')

function allProse(): string[] {
  return [
    copy.title,
    copy.summary,
    ...copy.intro,
    ...copy.sections.flatMap((s) => [s.label, s.title, s.body]),
    copy.does.title,
    copy.does.body,
    copy.smsTitle,
  ]
}

describe('defaultAboutCopy', () => {
  it('bakes in the brand it was given and no other', () => {
    const rendered = allProse().join('\n')
    expect(rendered).toContain('ACME')
    expect(rendered).not.toMatch(/TOVIS|Tovis/)
  })

  it('names the brand in the title, the summary, and the opening paragraph', () => {
    expect(copy.title).toBe('What is ACME?')
    expect(copy.summary).toContain('ACME')
    expect(copy.intro[0]).toContain('ACME')
  })

  it('uses no em dashes, per the homepage voice', () => {
    for (const line of allProse()) {
      expect(line, line).not.toContain('—')
    }
  })

  it('states the limit next to every rolling-out capability it names', () => {
    const body = copy.sections.map((s) => s.body).join('\n')
    // Smart consultation: founder pilot.
    expect(body).toMatch(/one professional today/)
    // Camera: iPhone beta.
    expect(body).toMatch(/in beta now/)
    // Payments: rolling out, and the pro still collects their own way.
    expect(body).toMatch(/rolling out/)
    expect(body).toMatch(/the way you already do/)
  })

  it('has three big-picture sections with distinct titles', () => {
    expect(copy.sections).toHaveLength(3)
    const titles = copy.sections.map((s) => s.title)
    expect(new Set(titles).size).toBe(titles.length)
  })
})
