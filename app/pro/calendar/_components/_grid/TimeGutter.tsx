// app/pro/calendar/_components/_grid/TimeGutter.tsx
'use client'

import { useMemo } from 'react'
import type { CSSProperties } from 'react'

import { PX_PER_MINUTE } from '../../_utils/calendarMath'
import { clamp } from '../../_utils/date'

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeGutterProps = {
  totalMinutes: number
  timeZone: string
}

type HourMark = {
  hour: number
  minute: number
  label: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const MIN_RENDER_MINUTES = MINUTES_PER_HOUR
const LABEL_TOP_OFFSET_PX = 2

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normalizeTotalMinutes(totalMinutes: number): number {
  if (!Number.isFinite(totalMinutes)) return MINUTES_PER_DAY

  return clamp(
    Math.trunc(totalMinutes),
    MIN_RENDER_MINUTES,
    MINUTES_PER_DAY,
  )
}

/**
 * Compact 12-hour label with no AM/PM suffix.
 * Example: 0 → "12", 13 → "1".
 */
function formatHourLabel(hour24: number): string {
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

function gutterStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--bg-primary) / 0.96)',
    color: 'rgb(var(--text-muted))',
  }
}

function gutterRuleStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--surface-glass) / 0.06)',
  }
}

function labelStyle(): CSSProperties {
  return {
    top: LABEL_TOP_OFFSET_PX,
    color: 'rgb(var(--text-muted) / 0.82)',
  }
}

function timelineHeightStyle(totalMinutes: number): CSSProperties {
  return {
    height: totalMinutes * PX_PER_MINUTE,
  }
}

function hourPositionStyle(minute: number): CSSProperties {
  return {
    top: minute * PX_PER_MINUTE,
  }
}

// ─── Exported component ───────────────────────────────────────────────────────

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
      className="relative border-r border-[var(--line)] font-mono"
      style={gutterStyle()}
      aria-label={`Calendar time gutter, ${timeZone}`}
      data-calendar-time-gutter="1"
    >
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-px"
        style={gutterRuleStyle()}
        aria-hidden="true"
      />

      <div className="relative" style={timelineHeightStyle(safeTotalMinutes)}>
        {hourMarks.map((mark) => (
          <TimeGutterHour key={mark.hour} mark={mark} />
        ))}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TimeGutterHour(props: { mark: HourMark }) {
  const { mark } = props

  return (
    <div
      className="absolute left-0 right-0"
      style={hourPositionStyle(mark.minute)}
    >
      <div
        className={[
          'absolute right-1.5 whitespace-nowrap text-right',
          'font-mono text-[8px] font-medium leading-none tracking-[0.04em]',
          'md:right-3 md:text-[10px]',
        ].join(' ')}
        style={labelStyle()}
      >
        {mark.label}
      </div>
    </div>
  )
}