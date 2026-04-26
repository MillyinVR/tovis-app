// app/pro/calendar/_components/_grid/DayHeaderRow.tsx
'use client'

import { useMemo } from 'react'
import type { CSSProperties } from 'react'

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
  weekdayFormatter: Intl.DateTimeFormat
  dayFormatter: Intl.DateTimeFormat
}): DayHeaderParts {
  const { date, weekdayFormatter, dayFormatter } = args
  const anchoredDate = anchoredVisibleDay(date)

  return {
    weekday: weekdayFormatter.format(anchoredDate),
    dayNumber: dayFormatter.format(anchoredDate),
  }
}

function rowStyle(gridCols: string): CSSProperties {
  return {
    gridTemplateColumns: gridCols,
    backgroundColor: 'rgb(var(--bg-primary) / 0.95)',
  }
}

function gutterCellStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--bg-primary))',
  }
}

function dayHeaderClassName(args: {
  isToday: boolean
  dayIdx: number
}): string {
  const { isToday, dayIdx } = args

  return [
    'relative flex h-[48px] min-w-0 flex-col items-center justify-center',
    'border-l px-1 text-center',
    'transition-colors',
    isToday
      ? 'border-accentPrimary/45'
      : dayIdx % 2 === 1
        ? 'border-[var(--line)]'
        : 'border-[var(--line)]',
  ].join(' ')
}

function dayHeaderStyle(args: {
  isToday: boolean
  dayIdx: number
}): CSSProperties {
  const { isToday, dayIdx } = args

  if (isToday) {
    return {
      backgroundColor: 'rgb(var(--accent-primary) / 0.22)',
      boxShadow:
        'inset 0 0 0 1px rgb(var(--accent-primary) / 0.35), inset 0 -2px 0 rgb(var(--accent-primary) / 0.95)',
    }
  }

  if (dayIdx % 2 === 1) {
    return {
      backgroundColor: 'rgb(var(--surface-glass) / 0.025)',
    }
  }

  return {
    backgroundColor: 'transparent',
  }
}

function weekdayClassName(): string {
  return [
    'relative z-10 font-mono text-[9px] font-medium uppercase leading-none',
    'tracking-[0.08em]',
  ].join(' ')
}

function weekdayStyle(isToday: boolean): CSSProperties {
  return {
    color: isToday
      ? 'rgb(var(--accent-primary-hover))'
      : 'rgb(var(--text-muted))',
  }
}

function dayNumberClassName(): string {
  return [
    'relative z-10 mt-1 font-display text-base font-semibold leading-none',
    'tracking-[-0.03em]',
  ].join(' ')
}

function dayNumberStyle(isToday: boolean): CSSProperties {
  return {
    color: isToday
      ? 'rgb(var(--accent-primary-hover))'
      : 'rgb(var(--text-primary))',
    textShadow: isToday
      ? '0 0 14px rgb(var(--accent-primary-hover) / 0.35)'
      : undefined,
  }
}

// ─── Exported component ───────────────────────────────────────────────────────

export function DayHeaderRow(props: DayHeaderRowProps) {
  const { visibleDays, timeZone, todayYmd, gridCols } = props

  const formatters = useMemo(
    () => ({
      weekday: new Intl.DateTimeFormat(undefined, {
        timeZone,
        weekday: 'short',
      }),
      day: new Intl.DateTimeFormat(undefined, {
        timeZone,
        day: 'numeric',
      }),
    }),
    [timeZone],
  )

  const dayHeaders = useMemo<DayHeader[]>(
    () =>
      visibleDays.map((date) => {
        const dayYmd = visibleDayKey(date, timeZone)

        return {
          dayYmd,
          isToday: dayYmd === todayYmd,
          parts: buildDayHeaderParts({
            date,
            weekdayFormatter: formatters.weekday,
            dayFormatter: formatters.day,
          }),
        }
      }),
    [formatters, timeZone, todayYmd, visibleDays],
  )

  return (
    <div
      className="grid border-b border-[var(--line-strong)] backdrop-blur-xl"
      style={rowStyle(gridCols)}
      data-calendar-day-header-row="1"
    >
      <div
        className="relative h-[48px] border-r border-[var(--line-strong)]"
        style={gutterCellStyle()}
        aria-hidden="true"
      />

      {dayHeaders.map((header, dayIdx) => (
        <div
          key={header.dayYmd}
          className={dayHeaderClassName({
            isToday: header.isToday,
            dayIdx,
          })}
          style={dayHeaderStyle({
            isToday: header.isToday,
            dayIdx,
          })}
          data-calendar-day-header={header.dayYmd}
          data-calendar-today={header.isToday ? '1' : '0'}
          aria-current={header.isToday ? 'date' : undefined}
        >
          {header.isToday ? (
            <>
              <span
                className="pointer-events-none absolute inset-y-0 left-0 w-px bg-accentPrimary/60"
                aria-hidden="true"
              />

              <span
                className="pointer-events-none absolute inset-y-0 right-0 w-px bg-accentPrimary/35"
                aria-hidden="true"
              />

              <span
                className="pointer-events-none absolute inset-x-0 top-0 h-full bg-gradient-to-b from-paper/[0.08] to-transparent"
                aria-hidden="true"
              />
            </>
          ) : null}

          <p
            className={weekdayClassName()}
            style={weekdayStyle(header.isToday)}
          >
            {header.parts.weekday}
          </p>

          <p
            className={dayNumberClassName()}
            style={dayNumberStyle(header.isToday)}
          >
            {header.parts.dayNumber}
          </p>
        </div>
      ))}
    </div>
  )
}