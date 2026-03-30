// app/(main)/booking/AvailabilityDrawer/components/MobileAddressSelector.tsx
'use client'

import type { MobileAddressOption } from '../types'

type Props = {
  value: string | null
  options: MobileAddressOption[]
  loading: boolean
  error: string | null
  disabled?: boolean
  onChange: (id: string) => void
  onAddAddress: () => void
}

export default function MobileAddressSelector(props: Props) {
  const {
    value,
    options,
    loading,
    error,
    disabled,
    onChange,
    onAddAddress,
  } = props

  const isDisabled = Boolean(disabled)
  const hasOptions = options.length > 0

  return (
    <div data-testid="mobile-address-section" className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-black text-textPrimary">
            Mobile service address
          </div>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            Choose where the pro should come for this appointment.
          </div>
        </div>

        <button
          type="button"
          data-testid="mobile-address-add-button"
          onClick={onAddAddress}
          disabled={isDisabled}
          className={[
            'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-black transition',
            'border-accentPrimary/30 bg-accentPrimary/12 text-textPrimary',
            isDisabled
              ? 'cursor-not-allowed opacity-60'
              : 'hover:border-accentPrimary/45 hover:bg-accentPrimary/18',
          ].join(' ')}
        >
          Add address
        </button>
      </div>

      {loading ? (
        <div className="mt-3 rounded-card border border-white/10 bg-bgPrimary/25 px-3 py-3 text-[12px] font-semibold text-textSecondary">
          Loading saved addresses…
        </div>
      ) : null}

      {!loading && error ? (
        <div className="mt-3 rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-3 text-[12px] font-semibold text-toneDanger">
          {error}
        </div>
      ) : null}

      {!loading && !error && !hasOptions ? (
        <div data-testid="mobile-address-empty-state" className="mt-3 rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-3">
          <div className="text-[12px] font-black text-textPrimary">
            No saved mobile addresses yet
          </div>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            Add one now so the pro knows where to come.
          </div>

          <button
            type="button"
            onClick={onAddAddress}
            disabled={isDisabled}
            className={[
              'mt-3 inline-flex rounded-full border px-3 py-1.5 text-[11px] font-black transition',
              'border-accentPrimary/30 bg-accentPrimary/12 text-textPrimary',
              isDisabled
                ? 'cursor-not-allowed opacity-60'
                : 'hover:border-accentPrimary/45 hover:bg-accentPrimary/18',
            ].join(' ')}
          >
            Add first address
          </button>
        </div>
      ) : null}

      {!loading && !error && hasOptions ? (
        <div className="mt-3 grid gap-2">
          {options.map((address) => {
            const active = value === address.id

            return (
              <button
                key={address.id}
                type="button"
                data-testid={`mobile-address-option-${address.id}`}
                onClick={() => {
                  if (isDisabled) return
                  if (active) return
                  onChange(address.id)
                }}
                disabled={isDisabled}
                aria-pressed={active}
                className={[
                  'w-full rounded-card border p-3 text-left transition',
                  active
                    ? 'border-accentPrimary/45 bg-accentPrimary/12'
                    : 'border-white/10 bg-bgPrimary/25 hover:bg-white/6',
                  isDisabled
                    ? 'cursor-not-allowed opacity-70'
                    : 'cursor-pointer',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-black text-textPrimary">
                      {address.label}
                    </div>

                    <div className="mt-1 whitespace-pre-line text-[12px] font-semibold leading-5 text-textSecondary">
                      {address.formattedAddress}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {address.isDefault ? (
                      <span className="rounded-full border border-white/10 bg-bgPrimary/35 px-2 py-1 text-[10px] font-black text-textSecondary">
                        Default
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
      ) : null}

      {!loading && !error && hasOptions && !value ? (
        <div className="mt-3 rounded-card border border-toneDanger/20 bg-toneDanger/10 px-3 py-2 text-[12px] font-semibold text-toneDanger">
          Select a service address before choosing a mobile time.
        </div>
      ) : null}
    </div>
  )
}