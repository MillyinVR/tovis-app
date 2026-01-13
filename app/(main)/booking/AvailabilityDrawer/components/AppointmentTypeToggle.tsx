// app/(main)/booking/AvailabilityDrawer/components/AppointmentTypeToggle.tsx

'use client'

import type { ServiceLocationType } from '../types'

export default function AppointmentTypeToggle({
  value,
  onChange,
  disabled,
}: {
  value: ServiceLocationType
  onChange: (v: ServiceLocationType) => void
  disabled?: boolean
}) {
  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="text-[13px] font-black text-textPrimary">Appointment type</div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {(['SALON', 'MOBILE'] as const).map((t) => {
          const active = value === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                if (disabled) return
                if (active) return
                onChange(t)
              }}
              className={[
                'h-11 rounded-full border text-[13px] font-black transition',
                'border-white/10',
                active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
              ].join(' ')}
            >
              {t === 'SALON' ? 'In-salon' : 'Mobile'}
            </button>
          )
        })}
      </div>

      <div className="mt-2 text-[12px] font-semibold text-textSecondary">
        Choose this first. It affects holds + availability.
      </div>
    </div>
  )
}
