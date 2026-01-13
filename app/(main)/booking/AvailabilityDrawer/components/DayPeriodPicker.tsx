'use client'

export default function DayPeriodPicker({
  value,
  onChange,
  disabled,
}: {
  value: 'MORNING' | 'AFTERNOON' | 'EVENING'
  onChange: (v: 'MORNING' | 'AFTERNOON' | 'EVENING') => void
  disabled?: boolean
}) {
  const options = [
    { key: 'MORNING', label: 'Morning' },
    { key: 'AFTERNOON', label: 'Afternoon' },
    { key: 'EVENING', label: 'Evening' },
  ] as const

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="text-[13px] font-black text-textPrimary">Time of day</div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {options.map((o) => {
          const active = o.key === value
          return (
            <button
              key={o.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.key)}
              className={[
                'h-11 rounded-full border text-[13px] font-black transition',
                'border-white/10',
                active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                disabled ? 'opacity-60 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
