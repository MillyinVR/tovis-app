// app/(main)/booking/AvailabilityDrawer/components/AppointmentTypeToggle.tsx
'use client'

import type { AvailabilityOffering, ServiceLocationType } from '../types'

type Props = {
  value: ServiceLocationType
  onChange: (value: ServiceLocationType) => void
  disabled?: boolean
  allowed?: {
    salon: boolean
    mobile: boolean
  }
  offering?: AvailabilityOffering
}

const MODE_META: Record<
  ServiceLocationType,
  {
    label: string
    testId: string
  }
> = {
  SALON: {
    label: 'In-salon',
    testId: 'booking-location-salon',
  },
  MOBILE: {
    label: 'Mobile',
    testId: 'booking-location-mobile',
  },
}

function formatMoneyString(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? ''
  return value ? value : null
}

function getModePrice(
  offering: AvailabilityOffering | undefined,
  mode: ServiceLocationType,
): string | null {
  if (!offering) return null

  return mode === 'MOBILE'
    ? formatMoneyString(offering.mobilePriceStartingAt)
    : formatMoneyString(offering.salonPriceStartingAt)
}

function getAvailableModes(args: {
  allowed?: Props['allowed']
  offering?: AvailabilityOffering
}): ServiceLocationType[] {
  const salonAllowed =
    (args.allowed?.salon ?? true) && (args.offering?.offersInSalon ?? true)

  const mobileAllowed =
    (args.allowed?.mobile ?? true) && (args.offering?.offersMobile ?? true)

  if (salonAllowed && mobileAllowed) return ['SALON', 'MOBILE']
  if (salonAllowed) return ['SALON']
  if (mobileAllowed) return ['MOBILE']
  return []
}

export default function AppointmentTypeToggle({
  value,
  onChange,
  disabled = false,
  allowed,
  offering,
}: Props) {
  const modes = getAvailableModes({ allowed, offering })

  if (modes.length === 0) return null

  const isSingleMode = modes.length === 1
  const effectiveValue = modes.includes(value) ? value : modes[0]
  const activeMeta = MODE_META[effectiveValue]
  const activePrice = getModePrice(offering, effectiveValue)

  if (isSingleMode) {
    return (
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-full border border-white/10 bg-bgPrimary/35 px-3 py-1 text-[12px] font-extrabold text-textPrimary">
          {activeMeta.label}
        </div>

        {activePrice ? (
          <div className="text-[12px] font-semibold text-textSecondary">
            From {activePrice}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mb-4">
      <div
        className="grid grid-cols-2 gap-2"
        aria-label="Appointment type"
      >
        {modes.map((mode) => {
          const selected = effectiveValue === mode
          const meta = MODE_META[mode]
          const modePrice = getModePrice(offering, mode)

          return (
            <button
              key={mode}
              type="button"
              data-testid={meta.testId}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => {
                if (disabled || selected) return
                onChange(mode)
              }}
              className={[
                'flex h-[54px] flex-col items-center justify-center gap-[2px] rounded-[14px] border px-2 transition',
                selected
                  ? 'border-accentPrimary/40 bg-accentPrimary text-bgPrimary'
                  : 'border-white/10 bg-bgPrimary/35 text-textPrimary hover:border-white/20 hover:bg-white/10',
                disabled
                  ? 'cursor-not-allowed opacity-60 hover:border-white/10 hover:bg-bgPrimary/35'
                  : 'cursor-pointer',
              ].join(' ')}
            >
              <span
                className={[
                  'text-[13px] font-black leading-none',
                  selected ? 'text-bgPrimary' : 'text-textPrimary',
                ].join(' ')}
              >
                {meta.label}
              </span>

              <span
                className={[
                  'text-[11px] font-semibold leading-none',
                  selected ? 'text-bgPrimary/70' : 'text-textSecondary',
                ].join(' ')}
              >
                {modePrice ? `From ${modePrice}` : 'No fee difference'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}