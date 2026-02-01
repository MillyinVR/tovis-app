// app/pro/calendar/_components/_grid/NowLineSpan.tsx
'use client'

/**
 * Gutter "now" marker ONLY.
 * The across-grid line is rendered inside each DayColumn to avoid stacking-context issues.
 */
export function NowLineSpan(props: { topPx: number }) {
  const { topPx } = props

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-[9999]"
      style={{
        top: topPx,
        left: 0,
        width: 'var(--cal-time-col)',
      }}
    >
      <div className="relative flex items-center justify-end pr-2">
        {/* subtle halo */}
        <div className="absolute right-2 -top-2 h-5 w-5 rounded-full bg-accentPrimary/12 blur-xl" />

        {/* dot */}
        <div className="relative h-2.5 w-2.5 rounded-full bg-accentPrimary ring-2 ring-bgPrimary/70 shadow-sm">
          {/* tiny highlight */}
          <div className="absolute left-[2px] top-[2px] h-1 w-1 rounded-full bg-white/35" />
        </div>
      </div>
    </div>
  )
}
