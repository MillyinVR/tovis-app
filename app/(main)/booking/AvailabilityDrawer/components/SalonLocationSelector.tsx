// app/(main)/booking/AvailabilityDrawer/components/SalonLocationSelector.tsx
'use client'

import type { AvailabilityLocationOption } from '../types'

type Props = {
  value: string | null
  options: AvailabilityLocationOption[]
  disabled?: boolean
  onChange: (id: string) => void
}

function optionTitle(option: AvailabilityLocationOption): string {
  const name = (option.name ?? '').trim()
  if (name) return name

  return option.type.trim().toUpperCase() === 'SUITE' ? 'Suite' : 'Salon'
}

function optionSubtitle(option: AvailabilityLocationOption): string | null {
  const address = (option.formattedAddress ?? '').trim()
  if (address) return address

  const cityState = [option.city, option.state]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ')

  return cityState || null
}

/**
 * Lets the client choose which of the pro's salons/suites to visit.
 * Only rendered when the pro has more than one bookable salon location.
 */
export default function SalonLocationSelector(props: Props) {
  const { value, options, disabled, onChange } = props

  const isDisabled = Boolean(disabled)

  if (options.length < 2) return null

  return (
    <div
      data-testid="salon-location-section"
      className="tovis-glass-soft mb-3 rounded-card p-4"
    >
      <div className="text-[13px] font-black text-textPrimary">Location</div>
      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
        This pro works from more than one location. Choose where you’d like to
        go.
      </div>

      <div className="mt-3 grid gap-2">
        {options.map((option) => {
          const active = value === option.id

          return (
            <button
              key={option.id}
              type="button"
              data-testid={`salon-location-option-${option.id}`}
              onClick={() => {
                if (isDisabled) return
                if (active) return
                onChange(option.id)
              }}
              disabled={isDisabled}
              aria-pressed={active}
              className={[
                'w-full rounded-card border p-3 text-left transition',
                active
                  ? 'border-accentPrimary/45 bg-accentPrimary/12'
                  : 'border-white/10 bg-bgPrimary/25 hover:bg-white/6',
                isDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-black text-textPrimary">
                    {optionTitle(option)}
                  </div>

                  {optionSubtitle(option) ? (
                    <div className="mt-1 text-[12px] font-semibold leading-5 text-textSecondary">
                      {optionSubtitle(option)}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {option.isPrimary ? (
                    <span className="rounded-full border border-white/10 bg-bgPrimary/35 px-2 py-1 text-[10px] font-black text-textSecondary">
                      Main
                    </span>
                  ) : null}

                  <span
                    className={[
                      'mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black',
                      active
                        ? 'border-accentPrimary/60 bg-accentPrimary/18 text-textPrimary'
                        : 'border-white/14 bg-bgPrimary/35 text-transparent',
                    ].join(' ')}
                    aria-hidden="true"
                  >
                    •
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
