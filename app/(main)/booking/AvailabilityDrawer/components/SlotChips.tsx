// app/(main)/booking/AvailabilityDrawer/components/SlotChips.tsx
'use client'

import { memo, useCallback, useMemo, useRef } from 'react'

import type { ProCard, SelectedHold } from '../types'
import {
  formatSlotFullLabel,
  formatSlotLabel,
  getHourInTimeZone,
} from '@/lib/bookingTime'

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

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

type PeriodOption = {
  key: Period
  label: string
}

type PeriodButtonProps = {
  nextPeriod: Period
  label: string
  active: boolean
  disabled: boolean
  onSelectPeriod: (period: Period) => void
}

type SlotButtonProps = {
  proId: string
  offeringId: string | null
  slotISO: string
  appointmentTz: string
  isSelected: boolean
  disabled: boolean
  onPickSlot: (proId: string, offeringId: string | null, slotISO: string) => void
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { key: 'MORNING', label: 'Morning' },
  { key: 'AFTERNOON', label: 'Afternoon' },
  { key: 'EVENING', label: 'Evening' },
]

function periodOfHour(hour: number): Period {
  if (hour < 12) return 'MORNING'
  if (hour < 17) return 'AFTERNOON'
  return 'EVENING'
}

function slotChipTestId(slotISO: string): string {
  return `availability-slot-${slotISO}`
}

const PeriodButton = memo(function PeriodButton({
  nextPeriod,
  label,
  active,
  disabled,
  onSelectPeriod,
}: PeriodButtonProps) {
  return (
    <button
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
      {label}
    </button>
  )
})

const SlotButton = memo(function SlotButton({
  proId,
  offeringId,
  slotISO,
  appointmentTz,
  isSelected,
  disabled,
  onPickSlot,
}: SlotButtonProps) {
  const title = useMemo(
    () => formatSlotFullLabel(slotISO, appointmentTz),
    [slotISO, appointmentTz],
  )

  const label = useMemo(
    () => formatSlotLabel(slotISO, appointmentTz),
    [slotISO, appointmentTz],
  )

  return (
    <button
      data-testid={slotChipTestId(slotISO)}
      type="button"
      onClick={() => {
        if (disabled) return
        if (typeof navigator !== 'undefined') {
          navigator.vibrate?.(10)
        }
        onPickSlot(proId, offeringId, slotISO)
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
      title={title}
    >
      {label}
    </button>
  )
})

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
  const onSelectPeriodRef = useRef(onSelectPeriod)
  const onPickRef = useRef(onPick)

  onSelectPeriodRef.current = onSelectPeriod
  onPickRef.current = onPick

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

  const periodDisabled = useMemo(
    () => ({
      MORNING: slotsByPeriod.MORNING.length === 0,
      AFTERNOON: slotsByPeriod.AFTERNOON.length === 0,
      EVENING: slotsByPeriod.EVENING.length === 0,
    }),
    [slotsByPeriod],
  )

  const visibleSlots = slotsByPeriod[period]
  const offeringId = pro.offeringId ?? null

  const handleSelectPeriod = useCallback((nextPeriod: Period) => {
    onSelectPeriodRef.current(nextPeriod)
  }, [])

  const handlePickSlot = useCallback(
    (proId: string, nextOfferingId: string | null, slotISO: string) => {
      onPickRef.current(proId, nextOfferingId, slotISO)
    },
    [],
  )

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
        {PERIOD_OPTIONS.map(({ key, label }) => (
          <PeriodButton
            key={key}
            nextPeriod={key}
            label={label}
            active={period === key}
            disabled={periodDisabled[key]}
            onSelectPeriod={handleSelectPeriod}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {visibleSlots.length > 0 ? (
          visibleSlots.map((slotISO) => {
            const isSelected =
              selected?.proId === pro.id && selected?.slotISO === slotISO
            const disabled = !offeringId || holding

            return (
              <SlotButton
                key={slotISO}
                proId={pro.id}
                offeringId={offeringId}
                slotISO={slotISO}
                appointmentTz={appointmentTz}
                isSelected={isSelected}
                disabled={disabled}
                onPickSlot={handlePickSlot}
              />
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