// app/pro/services/PrepayScopePicker.tsx
'use client'

import { OfferingPrepayScope } from '@/lib/prismaEnums'

import { cn } from '@/lib/utils'

/**
 * K10 (D4 = per-service prepay): the pro decides, per service, whether it must
 * be paid in full before the appointment — and what "in full" covers when the
 * booking also carries add-ons.
 *
 * 🔴 The third option exists because Tori settled the mixed-booking question on
 * 2026-07-30 as "the PRO decides". A booking carries several
 * `BookingServiceItem`s but only its base offering can demand prepay (add-ons
 * hang off an `OfferingAddOn` and own no offering row), so the choice is
 * genuinely between "just this service" and "the whole booking" — and the
 * system does not get to pick.
 *
 * A real radio group for the same reasons as `CalendarSwatchPicker`: arrow-key
 * navigation, a single tab stop and correct grouping come free from native
 * inputs, and `disabled` is set on the fieldset AND each input so anything
 * reading the control rather than the group is told the truth.
 */

type Option = {
  value: OfferingPrepayScope | null
  label: string
  hint: string
}

const OPTIONS: readonly Option[] = [
  {
    value: null,
    label: 'Off',
    hint: 'Follows your usual deposit setting.',
  },
  {
    value: OfferingPrepayScope.SERVICE_ONLY,
    label: 'This service only',
    hint: 'Collects this service’s price up front. Add-ons stay on the final bill.',
  },
  {
    value: OfferingPrepayScope.ENTIRE_BOOKING,
    label: 'Whole booking',
    hint: 'Collects the entire booking total up front, add-ons included.',
  },
]

export default function PrepayScopePicker(props: {
  /** The current requirement; `null` = no prepay. */
  value: OfferingPrepayScope | null
  onChange: (next: OfferingPrepayScope | null) => void
  disabled?: boolean
  /** Unique per offering — several pickers share one page. */
  name: string
}) {
  const { value, onChange, disabled = false, name } = props

  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-[11px] font-black text-textSecondary">
        Require payment up front
      </legend>

      <div className="flex flex-wrap items-center gap-2">
        {OPTIONS.map((option) => {
          const selected = value === option.value

          return (
            <label
              key={option.label}
              className="cursor-pointer"
              title={option.hint}
            >
              <input
                type="radio"
                name={name}
                className="peer sr-only"
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />

              <span
                className={cn(
                  'grid h-8 place-items-center rounded-full border px-3 text-[11px] font-black transition',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-accentPrimary/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bgSecondary',
                  selected
                    ? 'border-accentPrimary bg-accentPrimary/15 text-textPrimary'
                    : 'border-surfaceGlass/10 bg-bgPrimary/60 text-textSecondary hover:border-surfaceGlass/20',
                )}
              >
                {option.label}
              </span>
            </label>
          )
        })}
      </div>

      <div className="text-[11px] text-textSecondary/70">
        {value == null ? (
          <>
            Clients pay after the appointment, or leave whatever deposit your
            payment settings ask for.
          </>
        ) : (
          <>
            {value === OfferingPrepayScope.SERVICE_ONLY
              ? 'Clients pay this service’s price when they book; anything they add on is settled afterwards. '
              : 'Clients pay the whole booking when they book, so there is nothing left to collect on the day. '}
            It’s taken as a 100% deposit, so it’s credited against the bill and
            refunds follow your usual deposit rules — including the one where a
            client who cancels inside 24 hours forfeits it. This overrides your
            account-wide deposit setting, but it only applies once your Stripe
            payouts are set up.
          </>
        )}
      </div>
    </fieldset>
  )
}
