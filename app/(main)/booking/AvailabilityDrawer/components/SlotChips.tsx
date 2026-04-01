'use client'

import { useMemo } from 'react'

import type { ProCard, SelectedHold } from '../types'
import {
  formatSlotFullLabel,
  formatSlotLabel,
  getHourInTimeZone,
} from '@/lib/bookingTime'

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

function periodOfHour(hour: number): Period {
  if (hour < 12) return 'MORNING'
  if (hour < 17) return 'AFTERNOON'
  return 'EVENING'
}

function slotChipTestId(slotISO: string): string {
  return `availability-slot-${slotISO}`
}

type SlotChipsProps = {
  pro: ProCard
  appointmentTz: string
  holding: boolean
  selected: SelectedHold | null
  period: Period
  onSelectPeriod: (period: Period) => void
  slotsForDay: string[]
  onPick: (proId: string, offeringId: string | null, slotISO: string) => void
}

export default function SlotChips({
  pro,
  appointmentTz,
  holding,
  selected,
  period,
  onSelectPeriod,
  slotsForDay,
  onPick,
}: SlotChipsProps) {
  const allSlots = Array.isArray(slotsForDay) ? slotsForDay : []

  const slotsByPeriod = useMemo<Record<Period, string[]>>(() => {
    const grouped: Record<Period, string[]> = {
      MORNING: [],
      AFTERNOON: [],
      EVENING: [],
    }

    for (const slotISO of allSlots) {
      const hour = getHourInTimeZone(slotISO, appointmentTz)
      if (hour == null) continue
      grouped[periodOfHour(hour)].push(slotISO)
    }

    return grouped
  }, [allSlots, appointmentTz])

  const periodDisabled = {
    MORNING: slotsByPeriod.MORNING.length === 0,
    AFTERNOON: slotsByPeriod.AFTERNOON.length === 0,
    EVENING: slotsByPeriod.EVENING.length === 0,
  } as const

  const visibleSlots = slotsByPeriod[period]
  const offeringId = pro.offeringId ?? null

  return (
    <div
      data-testid="availability-slot-list"
      className="tovis-glass-soft mb-3 rounded-card p-4"
    >
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[13px] font-black text-textPrimary">
            Available times
          </div>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            Pick a time. We’ll hold it.
          </div>
        </div>

        {holding ? (
          <div className="text-[12px] font-semibold text-textSecondary">
            Holding…
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {(['MORNING', 'AFTERNOON', 'EVENING'] as const).map((nextPeriod) => {
          const active = period === nextPeriod
          const disabled = periodDisabled[nextPeriod]

          return (
            <button
              key={nextPeriod}
              data-testid={`availability-period-${nextPeriod.toLowerCase()}`}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (disabled || active) return
                onSelectPeriod(nextPeriod)
              }}
              disabled={disabled}
              className={[
                'h-10 rounded-full border text-[12px] font-black transition',
                'border-white/10',
                active
                  ? 'bg-accentPrimary text-bgPrimary'
                  : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                disabled
                  ? 'cursor-not-allowed opacity-40 hover:bg-bgPrimary/35'
                  : 'cursor-pointer',
              ].join(' ')}
              title={disabled ? 'No times in this period' : ''}
            >
              {nextPeriod === 'MORNING'
                ? 'Morning'
                : nextPeriod === 'AFTERNOON'
                  ? 'Afternoon'
                  : 'Evening'}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {visibleSlots.length > 0 ? (
          visibleSlots.map((slotISO) => {
            const isSelected =
              selected?.proId === pro.id && selected?.slotISO === slotISO
            const disabled = !offeringId || holding

            return (
              <button
                key={slotISO}
                data-testid={slotChipTestId(slotISO)}
                type="button"
                onClick={() => {
                  if (disabled) return
                  if (typeof navigator !== 'undefined') {
                    navigator.vibrate?.(10)
                  }
                  onPick(pro.id, offeringId, slotISO)
                }}
                disabled={disabled}
                className={[
                  'h-10 rounded-full border px-3 text-[13px] font-black transition',
                  'border-white/10',
                  isSelected
                    ? 'bg-accentPrimary text-bgPrimary'
                    : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                ].join(' ')}
                title={formatSlotFullLabel(slotISO, appointmentTz)}
              >
                {formatSlotLabel(slotISO, appointmentTz)}
              </button>
            )
          })
        ) : (
          <div className="text-[13px] font-semibold text-textSecondary">
            No{' '}
            {period === 'MORNING'
              ? 'morning'
              : period === 'AFTERNOON'
                ? 'afternoon'
                : 'evening'}{' '}
            times for this day.
          </div>
        )}
      </div>
    </div>
  )
}