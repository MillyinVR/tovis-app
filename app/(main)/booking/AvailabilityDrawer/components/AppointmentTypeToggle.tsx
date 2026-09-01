// app/(main)/booking/AvailabilityDrawer/components/AppointmentTypeToggle.tsx
'use client'

import { formatRoundedDollars } from '@/lib/money'
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
  /**
   * Book the Look, B4b: suppress the OFFERING's starting price. On a consult
   * proposal this figure is the floor service alone, which is smaller than the
   * "Starting at" the client agreed to — and decision 5's estimate framing
   * cannot travel with it in a pill this size. No price beats the wrong one.
   */
  hidePrice?: boolean
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

// ⚠️ This used to be a local no-op that trimmed the raw decimal string and
// returned it, so the toggle rendered "From 250" — a price with no currency
// symbol. `formatRoundedDollars` is the repo's one money formatter and was
// already imported two files away; there was never a second rule to implement.

function getModePrice(
  offering: AvailabilityOffering | undefined,
  mode: ServiceLocationType,
): string | null {
  if (!offering) return null

  return mode === 'MOBILE'
    ? formatRoundedDollars(offering.mobilePriceStartingAt)
    : formatRoundedDollars(offering.salonPriceStartingAt)
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
  hidePrice = false,
}: Props) {
  const modes = getAvailableModes({ allowed, offering })
  const firstMode = modes[0]

  if (firstMode === undefined) return null

  const isSingleMode = modes.length === 1
  const effectiveValue = modes.includes(value) ? value : firstMode
  const activeMeta = MODE_META[effectiveValue]
  const activePrice = hidePrice ? null : getModePrice(offering, effectiveValue)

  if (isSingleMode) {
    return (
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-full border border-textPrimary/10 bg-bgPrimary/35 px-3 py-1 text-[12px] font-extrabold text-textPrimary">
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
        aria-label="Booking type"
      >
        {modes.map((mode) => {
          const selected = effectiveValue === mode
          const meta = MODE_META[mode]
          const modePrice = hidePrice ? null : getModePrice(offering, mode)

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
                  : 'border-textPrimary/10 bg-bgPrimary/35 text-textPrimary hover:border-textPrimary/20 hover:bg-textPrimary/10',
                disabled
                  ? 'cursor-not-allowed opacity-60 hover:border-textPrimary/10 hover:bg-bgPrimary/35'
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

              {/* `hidePrice` means there is no price to state here at all —
                  "No fee difference" would be a claim about money this toggle
                  has deliberately stopped making. */}
              {hidePrice ? null : (
                <span
                  className={[
                    'text-[11px] font-semibold leading-none',
                    selected ? 'text-bgPrimary/70' : 'text-textSecondary',
                  ].join(' ')}
                >
                  {modePrice ? `From ${modePrice}` : 'No fee difference'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}