'use client'

import type { ServiceLocationType, AvailabilityOffering } from '../types'

type Props = {
  value: ServiceLocationType
  onChange: (v: ServiceLocationType) => void
  disabled?: boolean
  allowed?: {
    salon: boolean
    mobile: boolean
  }
  offering?: AvailabilityOffering
}

function moneyLabel(v: unknown) {
  if (typeof v === 'number' && Number.isFinite(v)) return `$${v.toFixed(0)}`
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function fromPriceForMode(
  offering: AvailabilityOffering | undefined,
  mode: ServiceLocationType,
) {
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
): {
  label: string
  eyebrow: string
  title: string
  subtitle: string
  from: string | null
  badge?: string
} {
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

function modeButtonLabel(mode: ServiceLocationType) {
  return mode === 'MOBILE' ? 'Mobile' : 'In-salon'
}

export default function AppointmentTypeToggle({
  value,
  onChange,
  disabled,
  allowed,
  offering,
}: Props) {
  const canSalon = allowed?.salon ?? true
  const canMobile = allowed?.mobile ?? true

  if (!canSalon && !canMobile) return null

  const modes: ServiceLocationType[] = []

  if (canSalon) modes.push('SALON')
  if (canMobile) modes.push('MOBILE')

  const isSingle = modes.length === 1
  const effective =
    isSingle || !modes.includes(value) ? modes[0] : value

  const isDisabled = Boolean(disabled)
  const active = getModeCopy(effective, offering)

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="text-[13px] font-black text-textPrimary">
        Appointment type
      </div>

      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
        {isSingle
          ? 'This service is only available in one appointment type.'
          : 'Availability and pricing update based on the selected appointment type.'}
      </div>

      {!isSingle ? (
        <div
          className={[
            'mt-3 grid gap-2',
            modes.length === 2 ? 'grid-cols-2' : 'grid-cols-1',
          ].join(' ')}
          aria-label="Appointment type"
        >
          {modes.map((mode) => {
            const selected = effective === mode

            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (isDisabled) return
                  if (selected) return
                  onChange(mode)
                }}
                disabled={isDisabled}
                aria-pressed={selected}
                className={[
                  'h-11 rounded-full border px-4 text-[13px] font-black transition',
                  selected
                    ? 'border-accentPrimary bg-accentPrimary text-bgPrimary'
                    : 'border-white/10 bg-bgPrimary/30 text-textPrimary hover:bg-white/10',
                  isDisabled
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
          isSingle
            ? 'border-white/10 bg-bgPrimary/35'
            : 'border-accentPrimary/25 bg-accentPrimary text-bgPrimary',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className={[
                'text-[11px] font-black uppercase tracking-[0.08em]',
                isSingle ? 'text-textSecondary' : 'text-bgPrimary/80',
              ].join(' ')}
            >
              {active.eyebrow}
            </div>

            <div
              className={[
                'mt-1 text-[16px] font-black',
                isSingle ? 'text-textPrimary' : 'text-bgPrimary',
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
                  isSingle
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
                  isSingle
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
            isSingle
              ? 'border-white/10 bg-white/5 text-textPrimary'
              : 'border-bgPrimary/20 bg-bgPrimary/12 text-bgPrimary',
          ].join(' ')}
        >
          {active.label}
        </div>

        <div
          className={[
            'mt-3 text-[13px] font-semibold leading-5',
            isSingle ? 'text-textSecondary' : 'text-bgPrimary/90',
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