// The pro client chart's tab vocabulary.
//
// Lives outside the page so the ONE piece of it that can silently do the wrong
// thing — resolving a tab id that no longer exists — is provable. See
// `RETIRED_CHART_TABS`.

export const CHART_TABS = [
  { id: 'notes', label: 'Notes' },
  { id: 'allergies', label: 'Allergies' },
  // Was "History", beside a separate "Photos" tab. They were two groupings of
  // the same visits, and each visit's frames now render on its own card.
  { id: 'history', label: 'Visits' },
  { id: 'products', label: 'Products' },
  { id: 'reviews-left', label: 'Reviews' },
  { id: 'pro-feedback', label: 'Pro feedback' },
  // Flag-gated (ENABLE_CLIENT_TECHNICAL_RECORD); only shown/queried when on.
  { id: 'technical', label: 'Technical record' },
] as const

export type ChartTab = (typeof CHART_TABS)[number]['id']

/**
 * Tab ids that no longer exist, and the tab that absorbed each.
 *
 * `?tab=photos` was the separate before/after timeline. A bookmark, a browser
 * history entry or a link a pro sent themselves must land on the view that
 * absorbed it — falling through to the default would drop them on Notes with no
 * hint that the photos they wanted are one tab over.
 */
export const RETIRED_CHART_TABS: Readonly<Record<string, ChartTab>> =
  Object.freeze({ photos: 'history' })

export function normalizeChartTab(raw: unknown): ChartTab {
  const normalized = String(raw ?? '').trim().toLowerCase()

  if (CHART_TABS.some((tab) => tab.id === normalized)) {
    return normalized as ChartTab
  }

  return RETIRED_CHART_TABS[normalized] ?? 'notes'
}
