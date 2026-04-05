// app/(main)/booking/AvailabilityDrawer/components/OtherPros.tsx
'use client'

import Link from 'next/link'
import { memo } from 'react'

import type { ProCard, SelectedHold } from '../types'
import { formatSlotFullLabel, formatSlotLabel } from '@/lib/bookingTime'

type OtherProsProps = {
  others: ProCard[]
  effectiveServiceId: string | null
  viewerTz: string | null
  appointmentTz: string
  holding: boolean
  selected: SelectedHold | null
  onPick: (proId: string, offeringId: string | null, slotISO: string) => void
  setRef: (el: HTMLDivElement | null) => void
}

function OtherPros({
  others,
  effectiveServiceId,
  viewerTz,
  appointmentTz,
  holding,
  selected,
  onPick,
  setRef,
}: OtherProsProps) {
  if (!effectiveServiceId) return null

  return (
    <div
      ref={setRef}
      data-testid="availability-other-pros"
      className="tovis-glass-soft rounded-card p-4"
    >
      <div className="text-[13px] font-black text-textPrimary">
        Other pros near you
      </div>

      {others.length > 0 ? (
        <div className="mt-3 grid gap-3">
          {others.map((pro) => {
            const name = pro.businessName?.trim() || 'Professional'
            const proTimeZone = pro.timeZone?.trim() || appointmentTz
            const showTimeZoneHint = Boolean(viewerTz && viewerTz !== proTimeZone)
            const slots = Array.isArray(pro.slots) ? pro.slots.slice(0, 4) : []
            const hasSlots = slots.length > 0

            return (
              <div
                key={pro.id}
                className="rounded-card border border-white/10 bg-bgPrimary/25 p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 overflow-hidden rounded-full bg-white/10">
                    {pro.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pro.avatarUrl}
                        alt={`${name} avatar`}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/professionals/${encodeURIComponent(pro.id)}`}
                      className="block truncate text-[13px] font-black text-textPrimary"
                    >
                      {name}
                    </Link>

                    {pro.location ? (
                      <div className="truncate text-[12px] font-semibold text-textSecondary">
                        {pro.location}
                      </div>
                    ) : null}

                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                      Times in{' '}
                      <span className="font-black text-textPrimary">
                        {proTimeZone}
                      </span>
                      {showTimeZoneHint ? <span> · You: {viewerTz}</span> : null}
                      {typeof pro.distanceMiles === 'number' ? (
                        <span> · {pro.distanceMiles.toFixed(1)} mi</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {hasSlots ? (
                    slots.map((iso) => {
                      const isSelected =
                        selected?.proId === pro.id && selected?.slotISO === iso
                      const disabled = !pro.offeringId || holding

                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => {
                            if (disabled) return
                            onPick(pro.id, pro.offeringId ?? null, iso)
                          }}
                          disabled={disabled}
                          className={[
                            'h-10 rounded-full border px-3 text-[13px] font-black transition',
                            'border-white/10',
                            isSelected
                              ? 'bg-accentPrimary text-bgPrimary'
                              : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                            disabled
                              ? 'cursor-not-allowed opacity-50'
                              : 'cursor-pointer',
                          ].join(' ')}
                          title={formatSlotFullLabel(iso, proTimeZone)}
                          aria-label={formatSlotFullLabel(iso, proTimeZone)}
                        >
                          {formatSlotLabel(iso, proTimeZone)}
                        </button>
                      )
                    })
                  ) : (
                    <div className="text-[13px] font-semibold text-textSecondary">
                      No available times for this day.
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-2 text-[13px] font-semibold text-textSecondary">
          No similar pros found yet.
        </div>
      )}
    </div>
  )
}

export default memo(OtherPros)
