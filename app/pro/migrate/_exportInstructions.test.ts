// app/pro/migrate/_exportInstructions.test.ts

import { describe, expect, it } from 'vitest'

import { SOURCE_APPS } from './_constants'
import { EXPORT_GUIDES, exportGuideFor } from './_exportInstructions'

describe('migration export instructions', () => {
  it('covers every source-app option the picker offers', () => {
    for (const app of SOURCE_APPS) {
      const guide = EXPORT_GUIDES[app]
      expect(guide, `missing export guide for ${app}`).toBeDefined()
      expect(guide.menu.length).toBeGreaterThan(0)
      expect(guide.clients.length).toBeGreaterThan(0)
      expect(guide.calendar.length).toBeGreaterThan(0)
      expect(typeof guide.calendarFeed).toBe('boolean')
    }
  })

  it('exportGuideFor returns the matching guide', () => {
    expect(exportGuideFor('Square')).toBe(EXPORT_GUIDES.Square)
    expect(exportGuideFor('Other')).toBe(EXPORT_GUIDES.Other)
  })

  it('flags live-feed apps so the calendar step can offer "keep synced"', () => {
    // Verified against each app's help docs 2026-07-15 (sources in the PR that
    // landed this revision):
    // - Acuity hands out a 1-way-sync subscribe URL.
    // - GlossGenius has a "Copy Calendar Link" iCal feed (its only export that
    //   includes future appointments).
    // - Fresha's "Export your Fresha Calendar" yields a subscribe URL (events
    //   are times-only — client/service details are stripped).
    expect(EXPORT_GUIDES.Acuity.calendarFeed).toBe(true)
    expect(EXPORT_GUIDES.GlossGenius.calendarFeed).toBe(true)
    expect(EXPORT_GUIDES.Fresha.calendarFeed).toBe(true)
    // No self-serve feed URL:
    // - Square Appointments has no iCal support (Google-account sync only).
    // - Vagaro stopped minting Apple/Outlook subscribe URLs for new
    //   connections in 2026 (Google-account sync only; one-off .ics remains).
    // - Booksy/StyleSeat have no outbound calendar export at all.
    expect(EXPORT_GUIDES.Square.calendarFeed).toBe(false)
    expect(EXPORT_GUIDES.Vagaro.calendarFeed).toBe(false)
    expect(EXPORT_GUIDES.Booksy.calendarFeed).toBe(false)
    expect(EXPORT_GUIDES.StyleSeat.calendarFeed).toBe(false)
    expect(EXPORT_GUIDES.Other.calendarFeed).toBe(false)
  })
})
