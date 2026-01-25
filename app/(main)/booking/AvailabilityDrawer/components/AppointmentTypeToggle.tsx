// app/(main)/booking/AvailabilityDrawer/components/AppointmentTypeToggle.tsx
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

  /**
   * Optional offering info to display "From $X" + feel like a value choice.
   */
  offering?: AvailabilityOffering
}

function moneyLabel(v: unknown) {
  if (typeof v === 'number' && Number.isFinite(v)) return `$${v.toFixed(0)}`
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function fromPriceForMode(offering: AvailabilityOffering | undefined, mode: ServiceLocationType) {
  if (!offering) return null
  const raw = mode === 'MOBILE' ? offering.mobilePriceStartingAt : offering.salonPriceStartingAt
  return moneyLabel(raw)
}

export default function AppointmentTypeToggle({ value, onChange, disabled, allowed, offering }: Props) {
  const canSalon = allowed?.salon ?? true
  const canMobile = allowed?.mobile ?? true

  if (!canSalon && !canMobile) return null

  const modes = ([...(canSalon ? (['SALON'] as const) : []), ...(canMobile ? (['MOBILE'] as const) : [])] as const) satisfies readonly ServiceLocationType[]
  const isSingle = modes.length === 1
  const effective = isSingle ? modes[0] : value

  const isDisabled = Boolean(disabled)

  // Single-mode: show a “locked” card
  if (isSingle) {
    const label = effective === 'SALON' ? 'In-salon' : 'Mobile'
    const from = fromPriceForMode(offering, effective)

    return (
      <div className="tovis-glass-soft mb-3 rounded-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-black text-textPrimary">Appointment type</div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              This service is available only as <span className="font-black text-textPrimary">{label.toLowerCase()}</span>.
            </div>
          </div>

          {from ? (
            <div className="shrink-0 rounded-full border border-white/10 bg-bgPrimary/35 px-3 py-2 text-[12px] font-black text-textPrimary">
              From {from}
            </div>
          ) : null}
        </div>

        <div className="mt-3">
          <div
            className={[
              'inline-flex h-12 w-full items-center justify-center rounded-full border text-[13px] font-black',
              'border-white/10 bg-bgPrimary/35 text-textPrimary',
            ].join(' ')}
            aria-label="Appointment type"
          >
            {label}
          </div>
        </div>
      </div>
    )
  }

  const cards: Array<{
    key: ServiceLocationType
    label: string
    title: string
    subtitle: string
    supported: boolean
    from: string | null
    badge?: string | null
  }> = [
    {
      key: 'SALON',
      label: 'In-salon',
      title: 'Best results',
      subtitle: 'Pro setup · ideal for precision + longer services',
      supported: canSalon,
      from: fromPriceForMode(offering, 'SALON'),
      badge: null,
    },
    {
      key: 'MOBILE',
      label: 'Mobile',
      title: 'Comes to you',
      subtitle: 'Great for busy days · events · comfort at home',
      supported: canMobile,
      from: fromPriceForMode(offering, 'MOBILE'),
      badge: 'Popular',
    },
  ]

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="text-[13px] font-black text-textPrimary">Appointment type</div>
      <div className="mt-1 text-[12px] font-semibold text-textSecondary">Choose the vibe. Pricing + availability adjust automatically.</div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {cards.map((c) => {
          if (!c.supported) {
            return (
              <div
                key={c.key}
                className={[
                  'rounded-card border border-white/10 bg-bgPrimary/15 p-3',
                  'opacity-60',
                ].join(' ')}
                aria-hidden="true"
              >
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-black text-textSecondary">{c.label}</div>
                  <div className="text-[11px] font-semibold text-textSecondary/70">Unavailable</div>
                </div>
                <div className="mt-1 text-[12px] font-semibold text-textSecondary/70">{c.subtitle}</div>
              </div>
            )
          }

          const active = effective === c.key

          return (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                if (isDisabled) return
                if (active) return
                onChange(c.key)
              }}
              disabled={isDisabled}
              className={[
                'rounded-card border p-3 text-left transition',
                'border-white/10',
                active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                isDisabled ? 'opacity-60 cursor-not-allowed hover:bg-bgPrimary/35' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] font-black">{c.label}</div>

                <div className="flex items-center gap-2">
                  {c.badge ? (
                    <span
                      className={[
                        'rounded-full border px-2 py-1 text-[10px] font-black',
                        active ? 'border-bgPrimary/25 bg-bgPrimary/15 text-bgPrimary' : 'border-white/10 bg-bgPrimary/35 text-textPrimary',
                      ].join(' ')}
                    >
                      {c.badge}
                    </span>
                  ) : null}

                  {c.from ? (
                    <span
                      className={[
                        'rounded-full border px-2 py-1 text-[10px] font-black',
                        active ? 'border-bgPrimary/25 bg-bgPrimary/15 text-bgPrimary' : 'border-white/10 bg-bgPrimary/35 text-textPrimary',
                      ].join(' ')}
                    >
                      From {c.from}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className={['mt-2 text-[12px] font-black', active ? 'text-bgPrimary' : 'text-textPrimary'].join(' ')}>
                {c.title}
              </div>
              <div className={['mt-1 text-[12px] font-semibold', active ? 'text-bgPrimary/90' : 'text-textSecondary'].join(' ')}>
                {c.subtitle}
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-2 text-[12px] font-semibold text-textSecondary">You won’t be charged until the pro confirms.</div>
    </div>
  )
}
