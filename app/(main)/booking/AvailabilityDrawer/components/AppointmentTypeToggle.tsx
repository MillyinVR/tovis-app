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

type ModeCopy = {
  label: string
  eyebrow: string
  title: string
  subtitle: string
  from: string | null
  badge?: string
}

function moneyLabel(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `$${value.toFixed(0)}`
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return null
}

function fromPriceForMode(
  offering: AvailabilityOffering | undefined,
  mode: ServiceLocationType,
): string | null {
  if (!offering) return null

  const raw =
    mode === 'MOBILE'
      ? offering.mobilePriceStartingAt
      : offering.salonPriceStartingAt

  return moneyLabel(raw)
}

function getModeCopy(
  mode: ServiceLocationType,
  offering?: AvailabilityOffering,
): ModeCopy {
  if (mode === 'MOBILE') {
    return {
      label: 'Mobile',
      eyebrow: 'Appointment type',
      title: 'Mobile appointment',
      subtitle:
        'The pro comes to you. Pricing and available times are shown for mobile service.',
      from: fromPriceForMode(offering, 'MOBILE'),
      badge: 'Comes to you',
    }
  }

  return {
    label: 'In-salon',
    eyebrow: 'Appointment type',
    title: 'In-salon appointment',
    subtitle:
      'You’re booking at the pro’s location. Pricing and available times are shown for in-salon service.',
    from: fromPriceForMode(offering, 'SALON'),
    badge: 'At the studio',
  }
}

function modeButtonLabel(mode: ServiceLocationType): string {
  return mode === 'MOBILE' ? 'Mobile' : 'In-salon'
}

function modeTestId(mode: ServiceLocationType): string {
  return mode === 'MOBILE'
    ? 'booking-location-mobile'
    : 'booking-location-salon'
}

export default function AppointmentTypeToggle({
  value,
  onChange,
  disabled = false,
  allowed,
  offering,
}: Props) {
  const canSalon = allowed?.salon ?? true
  const canMobile = allowed?.mobile ?? true

  if (!canSalon && !canMobile) return null

  const modes: ServiceLocationType[] = []
  if (canSalon) modes.push('SALON')
  if (canMobile) modes.push('MOBILE')

  const isSingleMode = modes.length === 1
  const effectiveValue =
    isSingleMode || !modes.includes(value) ? modes[0] : value
  const active = getModeCopy(effectiveValue, offering)

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="text-[13px] font-black text-textPrimary">
        Appointment type
      </div>

      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
        {isSingleMode
          ? 'This service is only available in one appointment type.'
          : 'Availability and pricing update based on the selected appointment type.'}
      </div>

      {!isSingleMode ? (
        <div
          className={[
            'mt-3 grid gap-2',
            modes.length === 2 ? 'grid-cols-2' : 'grid-cols-1',
          ].join(' ')}
          aria-label="Appointment type"
        >
          {modes.map((mode) => {
            const selected = effectiveValue === mode

            return (
              <button
                key={mode}
                type="button"
                data-testid={modeTestId(mode)}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return
                  if (selected) return
                  onChange(mode)
                }}
                className={[
                  'h-11 rounded-full border px-4 text-[13px] font-black transition',
                  selected
                    ? 'border-accentPrimary bg-accentPrimary text-bgPrimary'
                    : 'border-white/10 bg-bgPrimary/30 text-textPrimary hover:bg-white/10',
                  disabled
                    ? 'cursor-not-allowed opacity-60 hover:bg-bgPrimary/30'
                    : 'cursor-pointer',
                ].join(' ')}
              >
                {modeButtonLabel(mode)}
              </button>
            )
          })}
        </div>
      ) : null}

      <div
        className={[
          'mt-3 rounded-card border p-4 transition',
          isSingleMode
            ? 'border-white/10 bg-bgPrimary/35'
            : 'border-accentPrimary/25 bg-accentPrimary text-bgPrimary',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className={[
                'text-[11px] font-black uppercase tracking-[0.08em]',
                isSingleMode ? 'text-textSecondary' : 'text-bgPrimary/80',
              ].join(' ')}
            >
              {active.eyebrow}
            </div>

            <div
              className={[
                'mt-1 text-[16px] font-black',
                isSingleMode ? 'text-textPrimary' : 'text-bgPrimary',
              ].join(' ')}
            >
              {active.title}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {active.badge ? (
              <span
                className={[
                  'rounded-full border px-2.5 py-1 text-[10px] font-black',
                  isSingleMode
                    ? 'border-white/10 bg-bgPrimary/35 text-textPrimary'
                    : 'border-bgPrimary/20 bg-bgPrimary/12 text-bgPrimary',
                ].join(' ')}
              >
                {active.badge}
              </span>
            ) : null}

            {active.from ? (
              <span
                className={[
                  'rounded-full border px-2.5 py-1 text-[10px] font-black',
                  isSingleMode
                    ? 'border-white/10 bg-bgPrimary/35 text-textPrimary'
                    : 'border-bgPrimary/20 bg-bgPrimary/12 text-bgPrimary',
                ].join(' ')}
              >
                From {active.from}
              </span>
            ) : null}
          </div>
        </div>

        <div
          className={[
            'mt-3 inline-flex rounded-full border px-3 py-1.5 text-[12px] font-black',
            isSingleMode
              ? 'border-white/10 bg-white/5 text-textPrimary'
              : 'border-bgPrimary/20 bg-bgPrimary/12 text-bgPrimary',
          ].join(' ')}
        >
          {active.label}
        </div>

        <div
          className={[
            'mt-3 text-[13px] font-semibold leading-5',
            isSingleMode ? 'text-textSecondary' : 'text-bgPrimary/90',
          ].join(' ')}
        >
          {active.subtitle}
        </div>
      </div>

      <div className="mt-2 text-[12px] font-semibold text-textSecondary">
        You won’t be charged until the pro confirms.
      </div>
    </div>
  )
}