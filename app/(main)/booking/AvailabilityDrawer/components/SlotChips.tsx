// app/(main)/booking/AvailabilityDrawer/components/SlotChips.tsx
'use client'

import { memo, useCallback, useMemo } from 'react'

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

type PeriodButtonProps = {
  period: Period
  active: boolean
  disabled: boolean
  onSelect: (period: Period) => void
}

type SlotButtonProps = {
  proId: string
  offeringId: string | null
  slotISO: string
  appointmentTz: string
  isSelected: boolean
  disabled: boolean
  onPick: (proId: string, offeringId: string | null, slotISO: string) => void
}

const PERIOD_META: Record<
  Period,
  {
    label: string
    emptyCopy: string
    testId: string
  }
> = {
  MORNING: {
    label: 'Morning',
    emptyCopy: 'No morning times for this day.',
    testId: 'availability-period-morning',
  },
  AFTERNOON: {
    label: 'Afternoon',
    emptyCopy: 'No afternoon times for this day.',
    testId: 'availability-period-afternoon',
  },
  EVENING: {
    label: 'Evening',
    emptyCopy: 'No evening times for this day.',
    testId: 'availability-period-evening',
  },
}

const PERIOD_ORDER: Period[] = ['MORNING', 'AFTERNOON', 'EVENING']

function periodOfHour(hour: number): Period {
  if (hour < 12) return 'MORNING'
  if (hour < 17) return 'AFTERNOON'
  return 'EVENING'
}

function slotChipTestId(slotISO: string): string {
  return `availability-slot-${slotISO}`
}

function buildEmptyCopy(period: Period, hasAnySlots: boolean): string {
  if (!hasAnySlots) return 'No available times for this day.'
  return PERIOD_META[period].emptyCopy
}

function dedupeSlots(slotsForDay: string[]): string[] {
  if (slotsForDay.length <= 1) return slotsForDay
  return Array.from(new Set(slotsForDay))
}

const PeriodButton = memo(function PeriodButton({
  period,
  active,
  disabled,
  onSelect,
}: PeriodButtonProps) {
  const meta = PERIOD_META[period]

  return (
    <button
      data-testid={meta.testId}
      type="button"
      aria-pressed={active}
      onClick={() => {
        if (disabled || active) return
        onSelect(period)
      }}
      disabled={disabled}
      title={disabled ? 'No times in this period' : ''}
      className={[
        'rounded-full border px-0 py-[7px] text-[10px] font-black uppercase tracking-[0.1em] transition',
        'font-mono',
        active
          ? 'border-accentPrimary/40 bg-accentPrimary text-bgPrimary'
          : 'border-white/10 bg-bgPrimary/35 text-textSecondary hover:bg-white/10',
        disabled
          ? 'cursor-not-allowed opacity-40 hover:bg-bgPrimary/35'
          : 'cursor-pointer',
      ].join(' ')}
    >
      {meta.label}
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
  onPick,
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

        onPick(proId, offeringId, slotISO)
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={[
        'h-[38px] rounded-full border px-[14px] text-[13px] font-black transition',
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

function SlotChips({
  pro,
  appointmentTz,
  holding,
  selected,
  period,
  onSelectPeriod,
  slotsForDay,
  onPick,
}: SlotChipsProps) {
  const allSlots = useMemo(() => dedupeSlots(slotsForDay), [slotsForDay])

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

  const periodDisabled = useMemo<Record<Period, boolean>>(
    () => ({
      MORNING: slotsByPeriod.MORNING.length === 0,
      AFTERNOON: slotsByPeriod.AFTERNOON.length === 0,
      EVENING: slotsByPeriod.EVENING.length === 0,
    }),
    [slotsByPeriod],
  )

  const handleSelectPeriod = useCallback(
    (nextPeriod: Period) => {
      onSelectPeriod(nextPeriod)
    },
    [onSelectPeriod],
  )

  const handlePickSlot = useCallback(
    (proId: string, nextOfferingId: string | null, slotISO: string) => {
      onPick(proId, nextOfferingId, slotISO)
    },
    [onPick],
  )

  const hasAnySlots = allSlots.length > 0
  const visibleSlots = slotsByPeriod[period]
  const offeringId = pro.offeringId ?? null
  const disableSlotSelection = !offeringId || holding
  const emptyCopy = buildEmptyCopy(period, hasAnySlots)

  return (
    <div data-testid="availability-slot-list" className="mb-4">
      <div className="grid grid-cols-3 gap-[6px]">
        {PERIOD_ORDER.map((nextPeriod) => (
          <PeriodButton
            key={nextPeriod}
            period={nextPeriod}
            active={period === nextPeriod}
            disabled={periodDisabled[nextPeriod]}
            onSelect={handleSelectPeriod}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
        {visibleSlots.length > 0 ? (
          visibleSlots.map((slotISO) => {
            const isSelected =
              selected?.proId === pro.id && selected?.slotISO === slotISO

            return (
              <SlotButton
                key={slotISO}
                proId={pro.id}
                offeringId={offeringId}
                slotISO={slotISO}
                appointmentTz={appointmentTz}
                isSelected={isSelected}
                disabled={disableSlotSelection}
                onPick={handlePickSlot}
              />
            )
          })
        ) : (
          <div className="text-[13px] font-semibold text-textSecondary">
            {emptyCopy}
          </div>
        )}
      </div>

      {holding ? (
        <div className="mt-[10px] text-[12px] font-semibold text-textSecondary">
          Holding your time…
        </div>
      ) : null}
    </div>
  )
}

export default memo(SlotChips)