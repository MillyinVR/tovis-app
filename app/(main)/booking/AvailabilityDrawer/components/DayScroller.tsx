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

const DayButton = memo(function DayButton({ day, active, onSelectDay }: DayButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelectDay(day.ymd)}
      aria-pressed={active}
      style={{
        flexShrink: 0,
        minWidth: 54,
        padding: '10px 12px',
        borderRadius: 14,
        border: active ? 'none' : '1px solid rgba(244,239,231,0.12)',
        background: active ? '#E05A28' : 'rgba(244,239,231,0.06)',
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'background 0.15s ease',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 900,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: active ? 'rgba(255,255,255,0.9)' : 'rgba(244,239,231,0.55)',
          fontFamily: 'var(--font-mono)',
          lineHeight: 1,
        }}
      >
        {day.labelTop}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 18,
          fontWeight: 900,
          lineHeight: 1,
          color: active ? '#fff' : 'rgba(244,239,231,0.95)',
        }}
      >
        {day.labelBottom}
      </div>
    </button>
  )
})

export default function DayScroller({ days, selectedYMD, onSelect, onNearEnd }: DayScrollerProps) {
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
    <div
      className="looksNoScrollbar"
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 4,
        marginBottom: 16,
      }}
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
  )
}
