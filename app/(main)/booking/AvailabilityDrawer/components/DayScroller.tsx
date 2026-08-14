// app/(main)/booking/AvailabilityDrawer/components/DayScroller.tsx
'use client'

import { memo, useCallback, useEffect, useRef, type UIEvent } from 'react'

import { shouldPrefetchForScrollPosition } from '../utils/availabilityWindow'

type DayScrollerDay = {
  ymd: string
  labelTop: string
  labelBottom: string
  /** "6 open" / "2 left" — how much of this day is still bookable. */
  supplyLabel: string
  /** Down to the last couple of starts: worth drawing the eye to. */
  supplyScarce: boolean
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

/**
 * The day chip's test hook.
 *
 * ⚠️ The e2e suite restates this prefix in `tests/e2e/utils/selectors.ts`
 * (`testIds.availability.dayChipPrefix`) rather than importing it — pulling a
 * React component module into the Playwright process to read one string is a
 * worse trade. Rename in both places.
 */
function dayChipTestId(ymd: string): string {
  return `availability-day-${ymd}`
}

const DayButton = memo(function DayButton({
  day,
  active,
  onSelectDay,
}: DayButtonProps) {
  return (
    <button
      type="button"
      // A STABLE hook. This button's accessible name is assembled from its
      // visible lines, so it changed the moment the supply line was added and
      // took every name-matching e2e selector with it. The testid does not move
      // when the copy does.
      data-testid={dayChipTestId(day.ymd)}
      onClick={() => onSelectDay(day.ymd)}
      // Spelled out rather than left to the three stacked text nodes, which
      // would announce as "Fri1412 open".
      aria-label={`${day.labelTop} ${day.labelBottom}, ${day.supplyLabel}`}
      aria-pressed={active}
      style={{
        flexShrink: 0,
        minWidth: 54,
        padding: '10px 12px',
        borderRadius: 14,
        border: active ? 'none' : '1px solid rgb(var(--surface-glass) / 0.12)',
        background: active ? 'rgb(var(--accent-primary))' : 'rgb(var(--surface-glass) / 0.06)',
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
          color: active ? 'rgb(var(--text-primary) / 0.9)' : 'rgb(var(--text-primary) / 0.55)',
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
          color: active ? 'rgb(var(--text-primary))' : 'rgb(var(--text-primary) / 0.95)',
        }}
      >
        {day.labelBottom}
      </div>

      {/* How much of the day is left, so a scarce day is visible BEFORE it is
          opened — the frame's per-day supply. */}
      <div
        className={
          active
            ? 'text-textPrimary/70'
            : day.supplyScarce
              ? 'text-toneWarn'
              : 'text-textPrimary/45'
        }
        style={{
          marginTop: 5,
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '0.04em',
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap',
        }}
      >
        {day.supplyLabel}
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

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    onNearEndRef.current = onNearEnd
  }, [onNearEnd])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextOnNearEnd = onNearEndRef.current
    if (!nextOnNearEnd) return

    const el = event.currentTarget
    const isNearEnd = shouldPrefetchForScrollPosition({
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    })

    if (!isNearEnd) {
      nearEndTriggeredRef.current = false
      return
    }

    if (nearEndTriggeredRef.current) return

    nearEndTriggeredRef.current = true
    nextOnNearEnd()
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