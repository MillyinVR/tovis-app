// app/(main)/booking/AvailabilityDrawer/components/DayScroller.tsx
'use client'

import { memo, useCallback, useRef, type UIEvent } from 'react'

import { shouldPrefetchForScrollPosition } from '../utils/availabilityWindow'

type DayScrollerDay = {
  ymd: string
  labelTop: string
  labelBottom: string
}

type DayScrollerProps = {
  days: DayScrollerDay[]
  selectedYMD: string | null
  onSelect: (ymd: string) => void
  onNearEnd?: () => void
}

type DayButtonProps = {
  day: DayScrollerDay
  active: boolean
  onSelectDay: (ymd: string) => void
}

const DayButton = memo(function DayButton({
  day,
  active,
  onSelectDay,
}: DayButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelectDay(day.ymd)}
      className={[
        'min-w-21.5 rounded-2xl border px-3 py-3 text-left transition',
        active
          ? 'border-accentPrimary/40 bg-accentPrimary text-bgPrimary'
          : 'border-white/10 bg-bgPrimary/35 text-textPrimary hover:border-white/20 hover:bg-white/10',
      ].join(' ')}
      aria-pressed={active}
    >
      <div className="text-[11px] font-black uppercase tracking-wide opacity-90">
        {day.labelTop}
      </div>
      <div className="mt-1 text-[16px] font-black leading-none">
        {day.labelBottom}
      </div>
    </button>
  )
})

export default function DayScroller({
  days,
  selectedYMD,
  onSelect,
  onNearEnd,
}: DayScrollerProps) {
  const nearEndTriggeredRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  const onNearEndRef = useRef(onNearEnd)

  onSelectRef.current = onSelect
  onNearEndRef.current = onNearEnd

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextOnNearEnd = onNearEndRef.current
    if (!nextOnNearEnd) return

    const el = event.currentTarget
    const isNearEnd = shouldPrefetchForScrollPosition({
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    })

    if (isNearEnd) {
      if (!nearEndTriggeredRef.current) {
        nearEndTriggeredRef.current = true
        nextOnNearEnd()
      }
      return
    }

    nearEndTriggeredRef.current = false
  }, [])

  const handleSelectDay = useCallback((ymd: string) => {
    onSelectRef.current(ymd)
  }, [])

  return (
    <section className="tovis-glass-soft mb-3 rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="text-[13px] font-black text-textPrimary">Choose a day</div>

      <div
        className="looksNoScrollbar mt-3 flex gap-2 overflow-x-auto pb-1"
        onScroll={handleScroll}
      >
        {days.map((day) => (
          <DayButton
            key={day.ymd}
            day={day}
            active={day.ymd === selectedYMD}
            onSelectDay={handleSelectDay}
          />
        ))}
      </div>
    </section>
  )
}