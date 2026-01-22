// app/(main)/booking/AvailabilityDrawer/components/DayScroller.tsx
'use client'

export default function DayScroller({
  days,
  selectedYMD,
  onSelect,
}: {
  days: Array<{ ymd: string; labelTop: string; labelBottom: string }>
  selectedYMD: string | null
  onSelect: (ymd: string) => void
}) {
  return (
    <section className="tovis-glass-soft mb-3 rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="text-[13px] font-black text-textPrimary">Choose a day</div>

      <div className="looksNoScrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const active = d.ymd === selectedYMD

          return (
            <button
              key={d.ymd}
              type="button"
              onClick={() => onSelect(d.ymd)}
              className={[
                'min-w-21.5 rounded-2xl border px-3 py-3 text-left transition',
                active
                  ? 'border-accentPrimary/40 bg-accentPrimary text-bgPrimary'
                  : 'border-white/10 bg-bgPrimary/35 text-textPrimary hover:border-white/20 hover:bg-white/10',
              ].join(' ')}
              aria-pressed={active}
            >
              <div className="text-[11px] font-black uppercase tracking-wide opacity-90">{d.labelTop}</div>
              <div className="mt-1 text-[16px] font-black leading-none">{d.labelBottom}</div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
