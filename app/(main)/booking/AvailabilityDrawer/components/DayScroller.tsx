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
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="text-[13px] font-black text-textPrimary">Choose a day</div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 looksNoScrollbar">
        {days.map((d) => {
          const active = d.ymd === selectedYMD
          return (
            <button
              key={d.ymd}
              type="button"
              onClick={() => onSelect(d.ymd)}
              className={[
                'min-w-21.5 rounded-2xl border px-3 py-3 text-left transition',
                'border-white/10',
                active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
              ].join(' ')}
            >
              <div className="text-[12px] font-black uppercase tracking-wide">{d.labelTop}</div>
              <div className="mt-1 text-[16px] font-black leading-none">{d.labelBottom}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
