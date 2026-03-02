// app/(main)/booking/AvailabilityDrawer/components/SlotChips.tsx
'use client'

import { useMemo } from 'react'
import type { ProCard, SelectedHold } from '../types'
import { getHourInTimeZone, formatSlotLabel, formatSlotFullLabel } from '@/lib/bookingTime'

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

function periodOfHour(h: number): Period {
  if (h < 12) return 'MORNING'
  if (h < 17) return 'AFTERNOON'
  return 'EVENING'
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
}: {
  pro: ProCard
  appointmentTz: string
  holding: boolean
  selected: SelectedHold | null

  period: Period
  onSelectPeriod: (p: Period) => void

  slotsForDay: string[]
  onPick: (proId: string, offeringId: string | null, slotISO: string) => void
}) {
  const allSlots = Array.isArray(slotsForDay) ? slotsForDay : []

  const slotsByPeriod = useMemo(() => {
    const out: Record<Period, string[]> = { MORNING: [], AFTERNOON: [], EVENING: [] }
    for (const iso of allSlots) {
      const h = getHourInTimeZone(iso, appointmentTz)
      if (h == null) continue
      out[periodOfHour(h)].push(iso)
    }
    return out
  }, [allSlots, appointmentTz])

  const periodDisabled = {
    MORNING: slotsByPeriod.MORNING.length === 0,
    AFTERNOON: slotsByPeriod.AFTERNOON.length === 0,
    EVENING: slotsByPeriod.EVENING.length === 0,
  } as const

  const visibleSlots = slotsByPeriod[period]
  const offeringId = pro.offeringId ?? null

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[13px] font-black text-textPrimary">Available times</div>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">Pick a time. We’ll hold it.</div>
        </div>

        {holding ? <div className="text-[12px] font-semibold text-textSecondary">Holding…</div> : null}
      </div>

      {/* Period toggle */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(['MORNING', 'AFTERNOON', 'EVENING'] as const).map((p) => {
          const active = period === p
          const disabled = periodDisabled[p]

          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                if (disabled || active) return
                onSelectPeriod(p)
              }}
              disabled={disabled}
              className={[
                'h-10 rounded-full border text-[12px] font-black transition',
                'border-white/10',
                active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                disabled ? 'cursor-not-allowed opacity-40 hover:bg-bgPrimary/35' : 'cursor-pointer',
              ].join(' ')}
              title={disabled ? 'No times in this period' : ''}
            >
              {p === 'MORNING' ? 'Morning' : p === 'AFTERNOON' ? 'Afternoon' : 'Evening'}
            </button>
          )
        })}
      </div>

      {/* Times */}
      <div className="mt-3 flex flex-wrap gap-2">
        {visibleSlots.length ? (
          visibleSlots.map((iso) => {
            const isSelected = selected?.proId === pro.id && selected?.slotISO === iso
            const disabled = !offeringId || holding

            return (
              <button
                key={iso}
                type="button"
                onClick={() => onPick(pro.id, offeringId, iso)}
                disabled={disabled}
                className={[
                  'h-10 rounded-full border px-3 text-[13px] font-black transition',
                  'border-white/10',
                  isSelected ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                ].join(' ')}
                title={formatSlotFullLabel(iso, appointmentTz)}
              >
                {formatSlotLabel(iso, appointmentTz)}
              </button>
            )
          })
        ) : (
          <div className="text-[13px] font-semibold text-textSecondary">
            No {period === 'MORNING' ? 'morning' : period === 'AFTERNOON' ? 'afternoon' : 'evening'} times for this day.
          </div>
        )}
      </div>
    </div>
  )
}