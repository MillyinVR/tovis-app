// app/(main)/booking/AvailabilityDrawer/components/OtherPros.tsx
'use client'

import Link from 'next/link'
import { memo, useMemo } from 'react'

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

type OtherProSlotButtonProps = {
  proId: string
  offeringId: string | null
  slotISO: string
  timeZone: string
  isSelected: boolean
  disabled: boolean
  onPick: (proId: string, offeringId: string | null, slotISO: string) => void
}

function getDisplayName(pro: ProCard): string {
  return pro.businessName?.trim() || 'Professional'
}

function getTimeZone(pro: ProCard, appointmentTz: string): string {
  return pro.timeZone?.trim() || appointmentTz
}

function getSubtitleParts(args: {
  location: string | null | undefined
  distanceMiles: number | null | undefined
  showTimeZoneHint: boolean
  timeZone: string
}): string[] {
  const parts: string[] = []

  const location = args.location?.trim()
  if (location) {
    parts.push(location)
  }

  if (typeof args.distanceMiles === 'number' && Number.isFinite(args.distanceMiles)) {
    parts.push(`${args.distanceMiles.toFixed(1)} mi`)
  }

  if (args.showTimeZoneHint) {
    parts.push(args.timeZone)
  }

  return parts
}

function getVisibleSlots(slots: string[] | null | undefined): string[] {
  if (!Array.isArray(slots)) return []
  return slots.slice(0, 4)
}

const OtherProSlotButton = memo(function OtherProSlotButton({
  proId,
  offeringId,
  slotISO,
  timeZone,
  isSelected,
  disabled,
  onPick,
}: OtherProSlotButtonProps) {
  const title = useMemo(
    () => formatSlotFullLabel(slotISO, timeZone),
    [slotISO, timeZone],
  )

  const label = useMemo(
    () => formatSlotLabel(slotISO, timeZone),
    [slotISO, timeZone],
  )

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return
        onPick(proId, offeringId, slotISO)
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={[
        'h-9 rounded-full border px-3 text-[12px] font-black transition',
        isSelected
          ? 'border-accentPrimary bg-accentPrimary text-bgPrimary'
          : 'border-white/10 bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer',
      ].join(' ')}
    >
      {label}
    </button>
  )
})

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
      className="mb-4"
    >
      <div className="mb-[14px] flex items-center gap-[6px] pt-1">
        <span className="text-[10px] leading-none text-accentPrimary">◆</span>
        <span className="font-mono text-[11px] font-black uppercase tracking-[0.1em] text-textSecondary">
          Also available nearby
        </span>
      </div>

      {others.length > 0 ? (
        <div className="grid gap-[10px]">
          {others.map((pro) => {
            const name = getDisplayName(pro)
            const proTimeZone = getTimeZone(pro, appointmentTz)
            const showTimeZoneHint = Boolean(viewerTz && viewerTz !== proTimeZone)
            const subtitleParts = getSubtitleParts({
              location: pro.location,
              distanceMiles: pro.distanceMiles,
              showTimeZoneHint,
              timeZone: proTimeZone,
            })
            const slots = getVisibleSlots(pro.slots)
            const hasSlots = slots.length > 0
            const disabled = !pro.offeringId || holding

            return (
              <div
                key={pro.id}
                className="rounded-card border border-white/10 bg-bgPrimary/35 p-[14px]"
              >
                <div className="flex items-center gap-[10px]">
                  <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-bgPrimary/40">
                    {pro.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pro.avatarUrl}
                        alt={`${name} avatar`}
                        className="block h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-[15px] font-black text-textSecondary">
                        {name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/professionals/${encodeURIComponent(pro.id)}`}
                      className="block truncate text-[14px] font-black text-textPrimary no-underline"
                    >
                      {name}
                    </Link>

                    <div className="mt-[2px] truncate text-[11px] font-semibold text-textSecondary">
                      {subtitleParts.join(' · ')}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-[6px]">
                  {hasSlots ? (
                    slots.map((slotISO) => {
                      const isSelected =
                        selected?.proId === pro.id && selected?.slotISO === slotISO

                      return (
                        <OtherProSlotButton
                          key={slotISO}
                          proId={pro.id}
                          offeringId={pro.offeringId ?? null}
                          slotISO={slotISO}
                          timeZone={proTimeZone}
                          isSelected={isSelected}
                          disabled={disabled}
                          onPick={onPick}
                        />
                      )
                    })
                  ) : (
                    <div className="text-[12px] font-semibold text-textSecondary">
                      No available times for this day.
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-[13px] font-semibold text-textSecondary">
          No similar pros found nearby.
        </div>
      )}
    </div>
  )
}

export default memo(OtherPros)