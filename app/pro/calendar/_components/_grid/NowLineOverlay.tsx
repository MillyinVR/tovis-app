// app/pro/calendar/_components/_grid/NowLineOverlay.tsx
'use client'

export function NowLineOverlay(props: { topPx: number; show: boolean }) {
  const { topPx, show } = props
  if (!show) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 z-[999]"
      style={{ top: topPx }}
    >
      {/* grid layout: [gutter] [line] */}
      <div className="grid items-center" style={{ gridTemplateColumns: 'var(--cal-time-col) 1fr' }}>
        {/* empty gutter cell (keeps alignment) */}
        <div />

        {/* line across ALL days */}
        <div className="relative">
          <div className="h-[4px] w-full bg-orange-500 shadow-[0_0_20px_orange]" />
        </div>
      </div>
    </div>
  )
}
