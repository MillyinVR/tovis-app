// app/professionals/[id]/_components/ProfileBody.tsx
'use client'

import { useState, type ReactNode } from 'react'

import type { PublicProfileTab } from '@/lib/profiles/publicProfileFormatting'

export type ProfileBookBarProps = {
  /** Small-caps headline — the availability line, or the pending wording. */
  headline: string
  /** One line of context: cheapest service and how many there are. */
  subline: string
  ctaLabel: string
  /**
   * A pro who can't take bookings yet gets an inert, mono CTA rather than a
   * live one that would fail. The page above it is untouched — it is still
   * worth reading.
   */
  inert: boolean
  /** Shown under the bar for a signed-out viewer / a pending pro. */
  footnote: string | null
}

type ProfileBodyProps = {
  initialTab: PublicProfileTab
  labels: Record<PublicProfileTab, string>
  identityRail: ReactNode
  portfolio: ReactNode
  services: ReactNode
  reviews: ReactNode
  bookBar: ProfileBookBarProps
}

const TAB_ORDER: PublicProfileTab[] = ['portfolio', 'services', 'reviews']

/**
 * The profile below the header band: the identity rail, the tabbed work, and
 * the book bar — all three in one client component because the bar's CTA
 * SWITCHES THE TAB rather than navigating.
 *
 * Tabs switch IN PLACE. This replaces the old `?tab=` server round-trip: all
 * three panels arrive in one payload and only one renders at a time, which is
 * what iOS has always done. The panels and the rail are passed in as children,
 * so they are still SERVER-rendered — this component owns the selection, not
 * the content.
 *
 * `initialTab` still honours a `?tab=` deep link, so every URL that already
 * exists lands where it always did; it just no longer decides what gets fetched.
 */
export default function ProfileBody({
  initialTab,
  labels,
  identityRail,
  portfolio,
  services,
  reviews,
  bookBar,
}: ProfileBodyProps) {
  const [activeTab, setActiveTab] = useState<PublicProfileTab>(initialTab)

  const panels: Record<PublicProfileTab, ReactNode> = {
    portfolio,
    services,
    reviews,
  }

  return (
    <>
      <div className="brand-pp-body">
        {identityRail}

        <div className="mt-6">
          <div
            className="brand-pp-tabs"
            role="tablist"
            aria-label="Professional profile sections"
          >
            {TAB_ORDER.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`pp-tab-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls={`pp-panel-${tab}`}
                data-active={activeTab === tab ? 'true' : 'false'}
                className="brand-pp-tab brand-focus"
                onClick={() => setActiveTab(tab)}
              >
                {labels[tab]}
              </button>
            ))}
          </div>

          {TAB_ORDER.map((tab) => (
            <div
              key={tab}
              role="tabpanel"
              id={`pp-panel-${tab}`}
              aria-labelledby={`pp-tab-${tab}`}
              hidden={activeTab !== tab}
            >
              {panels[tab]}
            </div>
          ))}
        </div>
      </div>

      {/* Between the end of the scroll and the footer. It does not float and it
          does not follow the scroll — that is the whole point of it. */}
      <div className="brand-pp-bookbar">
        <div className="brand-pp-bookbar-inner">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-textMuted">
              {bookBar.headline}
            </div>
            <div className="mt-1 truncate text-[13px] text-textSecondary">
              {bookBar.subline}
            </div>
            {/* Inside the bar, not under it: the bar is PINNED, so a footnote
                below it would be stranded in the fixed nav's strip. */}
            {bookBar.footnote ? (
              <div className="mt-1 truncate font-mono text-[10px] text-textMuted">
                {bookBar.footnote}
              </div>
            ) : null}
          </div>

          {bookBar.inert ? (
            <span className="brand-pp-bookbar-cta" data-inert="true">
              {bookBar.ctaLabel}
            </span>
          ) : (
            <button
              type="button"
              className="brand-pp-bookbar-cta brand-focus"
              onClick={() => setActiveTab('services')}
            >
              {bookBar.ctaLabel}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
