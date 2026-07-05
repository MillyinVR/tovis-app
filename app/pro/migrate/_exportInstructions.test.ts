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
    // Apps known to hand out an iCal/subscription feed URL.
    expect(EXPORT_GUIDES.Acuity.calendarFeed).toBe(true)
    expect(EXPORT_GUIDES.Square.calendarFeed).toBe(true)
    expect(EXPORT_GUIDES.Vagaro.calendarFeed).toBe(true)
    // Export-only apps.
    expect(EXPORT_GUIDES.GlossGenius.calendarFeed).toBe(false)
    expect(EXPORT_GUIDES.Other.calendarFeed).toBe(false)
  })
})
