// app/(main)/booking/AvailabilityDrawer/components/SlotChips.tsx
'use client'

import type { ProCard, SelectedHold } from '../types'
import { getHourInTimeZone, formatSlotLabel, formatSlotFullLabel } from '@/lib/bookingTime'
import { formatInTimeZone } from '@/lib/formatInTimeZone'

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

function periodOfHour(h: number): Period {
  if (h < 12) return 'MORNING'
  if (h < 17) return 'AFTERNOON'
  return 'EVENING'
}

function fmtDayChipLabel(ymd: string, timeZone: string) {
  // stable "noon UTC" anchor avoids DST edge weirdness
  const d = new Date(`${ymd}T12:00:00.000Z`)
  return formatInTimeZone(d, timeZone, { weekday: 'short' })
}

function fmtDayChipNumber(ymd: string, timeZone: string) {
  const d = new Date(`${ymd}T12:00:00.000Z`)
  return formatInTimeZone(d, timeZone, { day: '2-digit' })
}

export default function SlotChips({
  pro,
  appointmentTz,
  holding,
  selected,
  days,
  selectedDayYMD,
  onSelectDay,
  period,
  onSelectPeriod,
  slotsForDay,
  onPick,
}: {
  pro: ProCard
  appointmentTz: string
  holding: boolean
  selected: SelectedHold | null

  days: Array<{ date: string; slotCount: number }>
  selectedDayYMD: string | null
  onSelectDay: (ymd: string) => void

  period: Period
  onSelectPeriod: (p: Period) => void

  slotsForDay: string[]
  onPick: (proId: string, offeringId: string | null, slotISO: string, proTimeZone?: string | null) => void
}) {
  const allSlots = slotsForDay || []

  const slotsByPeriod = {
    MORNING: allSlots.filter((iso) => {
      const h = getHourInTimeZone(iso, appointmentTz)
      return h != null && periodOfHour(h) === 'MORNING'
    }),
    AFTERNOON: allSlots.filter((iso) => {
      const h = getHourInTimeZone(iso, appointmentTz)
      return h != null && periodOfHour(h) === 'AFTERNOON'
    }),
    EVENING: allSlots.filter((iso) => {
      const h = getHourInTimeZone(iso, appointmentTz)
      return h != null && periodOfHour(h) === 'EVENING'
    }),
  } as const

  const periodDisabled = {
    MORNING: slotsByPeriod.MORNING.length === 0,
    AFTERNOON: slotsByPeriod.AFTERNOON.length === 0,
    EVENING: slotsByPeriod.EVENING.length === 0,
  } as const

  const visibleSlots = slotsByPeriod[period]

  return (
    <div className="tovis-glass-soft mb-3 rounded-card p-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[13px] font-black text-textPrimary">Available times</div>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">Pick a day, then a time. We’ll hold it.</div>
        </div>

        {holding ? <div className="text-[12px] font-semibold text-textSecondary">Holding…</div> : null}
      </div>

      {/* Day scroller */}
      {days?.length ? (
        <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => {
            const active = d.date === selectedDayYMD
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelectDay(d.date)}
                className={[
                  'min-w-70px rounded-2xl border px-3 py-2 text-left transition',
                  'border-white/10',
                  active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                ].join(' ')}
              >
                <div className={['text-[11px] font-black', active ? 'text-bgPrimary' : 'text-textSecondary'].join(' ')}>
                  {fmtDayChipLabel(d.date, appointmentTz)}
                </div>
                <div className="text-[18px] font-black leading-none">{fmtDayChipNumber(d.date, appointmentTz)}</div>
                <div
                  className={[
                    'mt-1 text-[11px] font-semibold',
                    active ? 'text-bgPrimary/90' : 'text-textSecondary',
                  ].join(' ')}
                >
                  {d.slotCount <= 2 ? `Only ${d.slotCount} left` : d.slotCount <= 6 ? 'Fills fast' : `${d.slotCount} slots`}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="mt-3 text-[13px] font-semibold text-textSecondary">No upcoming availability.</div>
      )}

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
                if (disabled) return
                if (active) return
                onSelectPeriod(p)
              }}
              disabled={disabled}
              className={[
                'h-10 rounded-full border text-[12px] font-black transition',
                'border-white/10',
                active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                disabled ? 'opacity-40 cursor-not-allowed hover:bg-bgPrimary/35' : 'cursor-pointer',
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
            return (
              <button
                key={iso}
                type="button"
                onClick={() => onPick(pro.id, pro.offeringId ?? null, iso, pro.timeZone)}
                disabled={!pro.offeringId || holding}
                className={[
                  'h-10 rounded-full border px-3 text-[13px] font-black transition',
                  'border-white/10',
                  isSelected ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary/35 text-textPrimary hover:bg-white/10',
                  !pro.offeringId || holding ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
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
