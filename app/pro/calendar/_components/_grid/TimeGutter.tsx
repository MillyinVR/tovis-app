// app/pro/calendar/_components/_grid/TimeGutter.tsx
'use client'

import { useMemo } from 'react'

import { PX_PER_MINUTE } from '../../_utils/calendarMath'
import { clamp } from '../../_utils/date'

type TimeGutterProps = {
  totalMinutes: number
  timeZone: string
}

type HourMark = {
  hour: number
  minute: number
  label: string
}

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const MIN_RENDER_MINUTES = MINUTES_PER_HOUR
const LABEL_TOP_OFFSET_PX = 2

function normalizeTotalMinutes(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes)) return MINUTES_PER_DAY

  return clamp(
    Math.trunc(totalMinutes),
    MIN_RENDER_MINUTES,
    MINUTES_PER_DAY,
  )
}

/**
 * Returns a compact 12-hour label with no AM/PM suffix (e.g. 0→"12", 13→"1").
 * Matches the prototype's minimal gutter — the surrounding context (working-hour
 * shading, scroll position) makes AM/PM redundant on a dense week grid.
 */
function formatHourLabel(hour24: number) {
  const hour = hour24 % 12
  return String(hour === 0 ? 12 : hour)
}

function buildHourMarks(totalMinutes: number): HourMark[] {
  const hourCount = Math.ceil(totalMinutes / MINUTES_PER_HOUR)

  return Array.from({ length: hourCount }, (_, hour) => ({
    hour,
    minute: hour * MINUTES_PER_HOUR,
    label: formatHourLabel(hour),
  }))
}

export function TimeGutter(props: TimeGutterProps) {
  const { totalMinutes, timeZone } = props

  const safeTotalMinutes = useMemo(
    () => normalizeTotalMinutes(totalMinutes),
    [totalMinutes],
  )

  const hourMarks = useMemo(
    () => buildHourMarks(safeTotalMinutes),
    [safeTotalMinutes],
  )

  return (
    <div
      className={[
        'relative border-r border-[var(--line-strong)] bg-[var(--ink)]/80',
        'font-mono text-[var(--paper-mute)]',
      ].join(' ')}
      aria-label={`Calendar time gutter, ${timeZone}`}
      data-calendar-time-gutter="1"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-[var(--paper)]/[0.05] to-transparent"
        aria-hidden="true"
      />

      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[var(--paper)]/[0.08]"
        aria-hidden="true"
      />

      <div
        className="relative"
        style={{ height: safeTotalMinutes * PX_PER_MINUTE }}
      >
        {hourMarks.map((mark) => (
          <TimeGutterHour key={mark.hour} mark={mark} />
        ))}
      </div>
    </div>
  )
}

function TimeGutterHour(props: { mark: HourMark }) {
  const { mark } = props

  return (
    <div
      className="absolute left-0 right-0"
      style={{ top: mark.minute * PX_PER_MINUTE }}
    >
      <div
        className={[
          'absolute left-0 right-0 px-1 text-center',
          'text-[10px] font-black uppercase tracking-[0.08em]',
          'text-[var(--paper-mute)] md:text-[11px]',
        ].join(' ')}
        style={{ top: LABEL_TOP_OFFSET_PX }}
      >
        {mark.label}
      </div>
    </div>
  )
}