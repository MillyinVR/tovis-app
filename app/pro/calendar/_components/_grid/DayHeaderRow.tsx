// app/pro/calendar/_components/_grid/DayHeaderRow.tsx
'use client'

import { useMemo } from 'react'

import { ymdInTimeZone } from '../../_utils/date'

type DayHeaderRowProps = {
  visibleDays: Date[]
  timeZone: string
  todayYmd: string
  gridCols: string
}

type DayHeaderParts = {
  weekday: string
  dayNumber: string
  month: string
}

const MIDDAY_MS = 12 * 60 * 60 * 1000

function anchoredVisibleDay(date: Date) {
  return new Date(date.getTime() + MIDDAY_MS)
}

function visibleDayKey(date: Date, timeZone: string) {
  return ymdInTimeZone(anchoredVisibleDay(date), timeZone)
}

function buildDayHeaderParts(args: {
  date: Date
  weekdayFormatter: Intl.DateTimeFormat
  dayFormatter: Intl.DateTimeFormat
  monthFormatter: Intl.DateTimeFormat
}): DayHeaderParts {
  const { date, weekdayFormatter, dayFormatter, monthFormatter } = args
  const safeDate = anchoredVisibleDay(date)

  return {
    weekday: weekdayFormatter.format(safeDate),
    dayNumber: dayFormatter.format(safeDate),
    month: monthFormatter.format(safeDate),
  }
}

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
      month: new Intl.DateTimeFormat(undefined, {
        timeZone,
        month: 'short',
      }),
    }),
    [timeZone],
  )

  const dayHeaders = useMemo(
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
            monthFormatter: formatters.month,
          }),
        }
      }),
    [formatters, timeZone, todayYmd, visibleDays],
  )

  return (
    <div
      className={[
        'grid border-b border-[var(--line-strong)]',
        'bg-[var(--ink)]/92 backdrop-blur-xl',
      ].join(' ')}
      style={{ gridTemplateColumns: gridCols }}
      data-calendar-day-header-row="1"
    >
      <div
        className={[
          'relative h-20 border-r border-[var(--line-strong)]',
          'bg-[var(--ink)]/80',
        ].join(' ')}
        aria-hidden="true"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[var(--paper)]/[0.05] to-transparent" />
      </div>

      {dayHeaders.map((header) => (
        <div
          key={header.dayYmd}
          className={[
            'relative flex h-20 min-w-0 flex-col items-center justify-center',
            'border-l border-[var(--line)] px-2 text-center',
            header.isToday
              ? 'bg-[var(--terra)]/[0.10]'
              : 'bg-[var(--paper)]/[0.015]',
          ].join(' ')}
          data-calendar-day-header={header.dayYmd}
          data-calendar-today={header.isToday ? '1' : '0'}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[var(--paper)]/[0.06] to-transparent"
            aria-hidden="true"
          />

          {header.isToday ? (
            <>
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--terra)]"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute inset-y-0 left-0 w-px bg-[var(--terra)]/60"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[var(--terra)]/35"
                aria-hidden="true"
              />
            </>
          ) : null}

          <p
            className={[
              'font-mono text-[9px] font-black uppercase tracking-[0.14em]',
              header.isToday
                ? 'text-[var(--terra-glow)]'
                : 'text-[var(--paper-mute)]',
            ].join(' ')}
          >
            {header.parts.weekday}
          </p>

          <p
            className={[
              'mt-1 font-display text-[30px] font-semibold italic leading-none tracking-[-0.06em]',
              header.isToday ? 'text-terra' : 'text-[var(--paper)]',
            ].join(' ')}
          >
            {header.parts.dayNumber}
          </p>

          <p className="mt-1 font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
            {header.parts.month}
          </p>
        </div>
      ))}
    </div>
  )
}