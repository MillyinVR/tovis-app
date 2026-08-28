import { describe, expect, it } from 'vitest'

import {
  CHART_TABS,
  RETIRED_CHART_TABS,
  normalizeChartTab,
} from '@/lib/clients/chartTabs'

describe('CHART_TABS', () => {
  it('no longer carries a separate photos tab', () => {
    // Each visit's frames render on its own card in the visits view; a Photos
    // tab still in this list would render an empty section.
    expect(CHART_TABS.map((tab) => tab.id)).not.toContain('photos')
  })

  it('labels the merged view "Visits"', () => {
    const history = CHART_TABS.find((tab) => tab.id === 'history')
    expect(history?.label).toBe('Visits')
  })

  it('has no duplicate ids', () => {
    const ids = CHART_TABS.map((tab) => tab.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('normalizeChartTab', () => {
  it('accepts every live tab, case- and whitespace-insensitively', () => {
    for (const tab of CHART_TABS) {
      expect(normalizeChartTab(tab.id)).toBe(tab.id)
      expect(normalizeChartTab(tab.id.toUpperCase())).toBe(tab.id)
      expect(normalizeChartTab(` ${tab.id} `)).toBe(tab.id)
    }
  })

  it('sends a retired tab to the view that absorbed it', () => {
    // The load-bearing case: a bookmarked `?tab=photos` must reach the visits
    // view, not fall through to the Notes default.
    expect(normalizeChartTab('photos')).toBe('history')
    expect(normalizeChartTab('PHOTOS')).toBe('history')
  })

  it('points every retired id at a tab that actually exists', () => {
    const live = new Set<string>(CHART_TABS.map((tab) => tab.id))
    for (const [retired, target] of Object.entries(RETIRED_CHART_TABS)) {
      expect(live.has(retired)).toBe(false)
      expect(live.has(target)).toBe(true)
    }
  })

  it('falls back to notes for junk', () => {
    for (const raw of [undefined, null, '', 'nonsense', 42]) {
      expect(normalizeChartTab(raw)).toBe('notes')
    }
  })
})
