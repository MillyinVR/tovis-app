'use client'

import type { ServiceLocationType } from '../types'

export function ModeToggle(props: {
  value: ServiceLocationType | null
  disabled: boolean
  onChange: (v: ServiceLocationType) => void
}) {
  const { value, disabled, onChange } = props

  return (
    <div className="grid gap-2">
      <div className="text-sm font-extrabold">Appointment type</div>

      <div className="flex gap-2">
        {(['SALON', 'MOBILE'] as ServiceLocationType[]).map((k) => {
          const active = value === k
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => onChange(k)}
              className={[
                'flex-1 rounded-xl px-4 py-2 text-sm font-extrabold',
                'border',
                active ? 'border-white/20 bg-bgSecondary' : 'border-white/10 bg-transparent hover:bg-bgSecondary/40',
                disabled ? 'opacity-70 cursor-default' : 'cursor-pointer',
              ].join(' ')}
            >
              {k === 'SALON' ? 'In-salon' : 'Mobile'}
            </button>
          )
        })}
      </div>

      <div className="text-xs text-textSecondary">
        Pricing is always <span className="font-extrabold text-textPrimary">starting at</span>.
      </div>
    </div>
  )
}
