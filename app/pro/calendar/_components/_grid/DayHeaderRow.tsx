// app/pro/calendar/_components/_grid/DayHeaderRow.tsx
'use client'

import { useMemo } from 'react'
import type { CSSProperties } from 'react'

import { formatInTimeZone } from '@/lib/time'

import { ymdInTimeZone } from '../../_utils/date'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayHeaderRowProps = {
  visibleDays: Date[]
  timeZone: string
  todayYmd: string
  gridCols: string
}

type DayHeaderParts = {
  weekday: string
  dayNumber: string
}

type DayHeader = {
  dayYmd: string
  isToday: boolean
  parts: DayHeaderParts
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDDAY_MS = 12 * 60 * 60 * 1000

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function anchoredVisibleDay(date: Date): Date {
  return new Date(date.getTime() + MIDDAY_MS)
}

function visibleDayKey(date: Date, timeZone: string): string {
  return ymdInTimeZone(anchoredVisibleDay(date), timeZone)
}

function buildDayHeaderParts(args: {
  date: Date
  timeZone: string
}): DayHeaderParts {
  const { date, timeZone } = args
  const anchoredDate = anchoredVisibleDay(date)

  return {
    weekday: formatInTimeZone(anchoredDate, timeZone, { weekday: 'short' }),
    dayNumber: formatInTimeZone(anchoredDate, timeZone, { day: 'numeric' }),
  }
}

function rowStyle(gridCols: string): CSSProperties {
  return {
    gridTemplateColumns: gridCols,
  }
}

// ─── Exported component ───────────────────────────────────────────────────────

export function DayHeaderRow(props: DayHeaderRowProps) {
  const { visibleDays, timeZone, todayYmd, gridCols } = props

  const dayHeaders = useMemo<DayHeader[]>(
    () =>
      visibleDays.map((date) => {
        const dayYmd = visibleDayKey(date, timeZone)

        return {
          dayYmd,
          isToday: dayYmd === todayYmd,
          parts: buildDayHeaderParts({
            date,
            timeZone,
          }),
        }
      }),
    [timeZone, todayYmd, visibleDays],
  )

  return (
    <div
      className="brand-pro-calendar-day-header-row"
      style={rowStyle(gridCols)}
      data-calendar-day-header-row="1"
    >
      <div
        className="brand-pro-calendar-day-header-gutter"
        aria-hidden="true"
      />

      {dayHeaders.map((header, dayIdx) => (
        <div
          key={header.dayYmd}
          className="brand-pro-calendar-day-header-cell"
          data-calendar-day-header={header.dayYmd}
          data-calendar-day-index={dayIdx}
          data-calendar-today={header.isToday ? 'true' : 'false'}
          aria-current={header.isToday ? 'date' : undefined}
        >
          <p className="brand-pro-calendar-day-header-weekday">
            {header.parts.weekday}
          </p>

          <p className="brand-pro-calendar-day-header-number">
            {header.parts.dayNumber}
          </p>
        </div>
      ))}
    </div>
  )
}