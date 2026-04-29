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
  displayHour: string
  meridiem: 'am' | 'pm'
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const MIN_RENDER_MINUTES = MINUTES_PER_HOUR

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normalizeTotalMinutes(totalMinutes: number): number {
  if (!Number.isFinite(totalMinutes)) return MINUTES_PER_DAY

  return clamp(
    Math.trunc(totalMinutes),
    MIN_RENDER_MINUTES,
    MINUTES_PER_DAY,
  )
}

function hourDisplayLabel(hour24: number): {
  displayHour: string
  meridiem: 'am' | 'pm'
} {
  const normalizedHour = hour24 % 24
  const hour12 = normalizedHour % 12
  const displayHour = hour12 === 0 ? 12 : hour12
  const meridiem = normalizedHour < 12 ? 'am' : 'pm'

  return {
    displayHour: String(displayHour),
    meridiem,
  }
}

function buildHourMarks(totalMinutes: number): HourMark[] {
  const hourCount = Math.ceil(totalMinutes / MINUTES_PER_HOUR)

  return Array.from({ length: hourCount }, (_, hour) => {
    const label = hourDisplayLabel(hour)

    return {
      hour,
      minute: hour * MINUTES_PER_HOUR,
      displayHour: label.displayHour,
      meridiem: label.meridiem,
    }
  })
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
      className="brand-pro-calendar-time-gutter"
      aria-label={`Calendar time gutter, ${timeZone}`}
      data-calendar-time-gutter="1"
    >
      <div
        className="brand-pro-calendar-time-gutter-rule"
        aria-hidden="true"
      />

      <div
        className="brand-pro-calendar-time-gutter-track"
        style={timelineHeightStyle(safeTotalMinutes)}
      >
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
      className="brand-pro-calendar-time-gutter-hour"
      style={hourPositionStyle(mark.minute)}
      data-calendar-hour={mark.hour}
    >
      <div className="brand-pro-calendar-time-gutter-label">
        <span>{mark.displayHour}</span>
        <span className="brand-pro-calendar-time-gutter-meridiem">
          {mark.meridiem}
        </span>
      </div>
    </div>
  )
}