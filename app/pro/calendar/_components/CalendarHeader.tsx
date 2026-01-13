// app/pro/calendar/_components/CalendarHeader.tsx

'use client'

import type { ViewMode } from '../_types'

export function CalendarHeader() {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <p className="text-sm text-textSecondary">Visual overview of your day, week, or month.</p>
      </div>

      <a href="/pro" className="text-sm text-textSecondary hover:text-textPrimary">
        ← Back to pro dashboard
      </a>
    </header>
  )
}

export function CalendarHeaderControls(props: {
  view: ViewMode
  setView: (v: ViewMode) => void
  headerLabel: string
  onToday: () => void
  onBack: () => void
  onNext: () => void
}) {
  const { view, setView, headerLabel, onToday, onBack, onNext } = props

  return (
    <section className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onToday} className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold hover:bg-bgSecondary/70">
          Today
        </button>
        <button type="button" onClick={onBack} className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold hover:bg-bgSecondary/70">
          ‹ Back
        </button>
        <button type="button" onClick={onNext} className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold hover:bg-bgSecondary/70">
          Next ›
        </button>

        <div className="ml-2 text-sm font-semibold">{headerLabel}</div>
      </div>

      <div className="flex items-center gap-2">
        {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setView(mode)}
            className={[
              'rounded-full border px-3 py-1.5 text-xs font-semibold',
              view === mode ? 'border-white/10 bg-bgPrimary text-textPrimary' : 'border-white/10 bg-bgSecondary text-textPrimary hover:bg-bgSecondary/70',
            ].join(' ')}
          >
            {mode[0].toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
    </section>
  )
}
