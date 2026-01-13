'use client'

export function MonthPicker(props: {
  monthLabel: string
  disabledPrev: boolean
  disabledNext: boolean
  disabledAll: boolean
  onPrev: () => void
  onNext: () => void
  gridDays: { ymd: string; inMonth: boolean }[]
  selectedYMD: string | null
  ymdWithinRange: (ymd: string) => boolean
  onPick: (ymd: string) => void
  todayYMD: string
  maxYMD: string
}) {
  const { monthLabel, disabledPrev, disabledNext, disabledAll, onPrev, onNext, gridDays, selectedYMD, ymdWithinRange, onPick, todayYMD, maxYMD } = props

  return (
    <div className="rounded-2xl border border-white/10 bg-bgPrimary p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabledAll || disabledPrev}
          onClick={onPrev}
          className="rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm font-extrabold hover:bg-bgSecondary/40 disabled:opacity-50"
          title={disabledAll ? 'Date is locked while a hold exists.' : undefined}
        >
          ‹
        </button>

        <div className="text-sm font-extrabold">{monthLabel}</div>

        <button
          type="button"
          disabled={disabledAll || disabledNext}
          onClick={onNext}
          className="rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm font-extrabold hover:bg-bgSecondary/40 disabled:opacity-50"
          title={disabledAll ? 'Date is locked while a hold exists.' : undefined}
        >
          ›
        </button>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-2 text-center text-[11px] font-extrabold text-textSecondary">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {gridDays.map((d) => {
          const isSelected = selectedYMD === d.ymd
          const disabled = disabledAll || !ymdWithinRange(d.ymd)
          const dayNum = Number(d.ymd.slice(8, 10))

          return (
            <button
              key={d.ymd}
              type="button"
              disabled={disabled}
              onClick={() => onPick(d.ymd)}
              className={[
                'rounded-xl py-2 text-center text-sm font-extrabold',
                'border',
                isSelected ? 'border-white/20 bg-bgSecondary' : 'border-white/10',
                d.inMonth ? 'bg-bgPrimary' : 'bg-bgSecondary/30',
                disabled ? 'opacity-50 cursor-default' : 'hover:bg-bgSecondary/50',
              ].join(' ')}
              title={!ymdWithinRange(d.ymd) ? 'Outside booking window' : undefined}
            >
              {dayNum}
            </button>
          )
        })}
      </div>

      <div className="mt-3 text-xs text-textSecondary">
        Booking window: {todayYMD} → {maxYMD} (pro timezone)
      </div>
    </div>
  )
}
