// app/(main)/booking/AvailabilityDrawer/components/AppointmentTypeToggle.tsx
'use client'

import type { ServiceLocationType } from '../types'

type Props = {
  value: ServiceLocationType
  onChange: (v: ServiceLocationType) => void
  disabled?: boolean

  /**
   * The offering determines which modes are actually valid.
   * If omitted, we assume both are allowed (defensive default).
   */
  allowed?: {
    salon: boolean
    mobile: boolean
  }
}

export default function AppointmentTypeToggle({ value, onChange, disabled, allowed }: Props) {
  const canSalon = allowed?.salon ?? true
  const canMobile = allowed?.mobile ?? true

  // If neither is allowed (shouldn't happen), render nothing to avoid broken UI
  if (!canSalon && !canMobile) return null

  const modes = ([...(canSalon ? (['SALON'] as const) : []), ...(canMobile ? (['MOBILE'] as const) : [])] as const) satisfies readonly ServiceLocationType[]

  const isSingle = modes.length === 1
  const effective = isSingle ? modes[0] : value

  // Single-mode: show a “locked” pill (no toggle)
  if (isSingle) {
    const label = effective === 'SALON' ? 'In-salon' : 'Mobile'
    return (
      <div className="tovis-glass-soft mb-3 rounded-card p-4">
        <div className="text-[13px] font-black text-textPrimary">Appointment type</div>

        <div className="mt-3">
          <div
            className={[
              'inline-flex h-11 w-full items-center justify-center rounded-full border text-[13px] font-black',
              'border-white/10 bg-bgPrimary/35 text-textPrimary',
            ].join(' ')}
            aria-label="Appointment type"
          >
            {label}
          </div>
        </div>

        <div className="mt-2 text-[12px] font-semibold text-textSecondary">
          This service is available only as{' '}
          <span className="font-black text-textPrimary">{label.toLowerCase()}</span>.
        </div>
      </div>
    )
  }

  const isDisabled = Boolean(disabled)

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="text-[13px] font-black text-textPrimary">Appointment type</div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {(['SALON', 'MOBILE'] as const).map((t) => {
          const supported = t === 'SALON' ? canSalon : canMobile
          const label = t === 'SALON' ? 'In-salon' : 'Mobile'

          if (!supported) {
            // Keep layout symmetrical but make it clearly unavailable
            return (
              <div
                key={t}
                className={[
                  'h-11 rounded-full border text-[13px] font-black',
                  'border-white/10 bg-bgPrimary/15 text-textSecondary/70',
                  'grid place-items-center opacity-70',
                ].join(' ')}
                aria-hidden="true"
              >
                {label}
              </div>
            )
          }

          const active = effective === t

          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                if (isDisabled) return
                if (active) return
                onChange(t)
              }}
              disabled={isDisabled}
              className={[
                'h-11 rounded-full border text-[13px] font-black transition',
                'border-white/10',
                active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                isDisabled ? 'opacity-60 cursor-not-allowed hover:bg-bgPrimary/35' : 'cursor-pointer',
              ].join(' ')}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="mt-2 text-[12px] font-semibold text-textSecondary">Choose this first. It affects holds + availability.</div>
    </div>
  )
}
