// app/pro/calendar/_components/MobileMonthGrid.tsx
'use client'

import { useMemo } from 'react'

import type { CalendarEvent } from '../_types'

import { WEEKDAY_KEYS_DISPLAY } from '../_utils/date'
import { isBlockedEvent } from '../_utils/calendarMath'
import { buildMonthDayCells } from '../_utils/monthGrid'
import { eventStatusTone } from '../_utils/statusStyles'

import {
  buildMonthDensityMap,
  monthDensityForDay,
} from '../_viewModel/monthDensity'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileMonthGridProps = {
  visibleDays: Date[]
  currentDate: Date
  events: CalendarEvent[]
  timeZone: string
  onPickDay: (day: Date) => void

  /**
   * Bridge until mobile month-grid microcopy is moved into BrandProCalendarCopy.
   */
  copy?: Partial<MobileMonthGridCopy>
}

type MobileMonthGridCopy = {
  itemSingular: string
  itemPlural: string
  todayLegend: string
  bookingsLegend: string
  swipeLegend: string
}

type MonthEventDotProps = {
  event: CalendarEvent
}

type MonthMoreDotProps = {
  count: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DOTS_PER_DAY = 4

const DEFAULT_COPY: MobileMonthGridCopy = {
  itemSingular: 'calendar item',
  itemPlural: 'calendar items',
  todayLegend: 'Today',
  bookingsLegend: 'Bookings',
  swipeLegend: 'Swipe ← → for other months',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function resolveCopy(
  copy: Partial<MobileMonthGridCopy> | undefined,
): MobileMonthGridCopy {
  return {
    ...DEFAULT_COPY,
    ...copy,
  }
}

function weekdayLabel(dayKey: string): string {
  return dayKey.slice(0, 1).toUpperCase()
}

function calendarEventTone(event: CalendarEvent): string {
  return eventStatusTone({
    status: event.status,
    isBlocked: isBlockedEvent(event),
  })
}

function calendarItemLabel(args: {
  count: number
  copy: MobileMonthGridCopy
}): string {
  const { count, copy } = args

  return count === 1 ? copy.itemSingular : copy.itemPlural
}

function dayAriaLabel(args: {
  dayYmd: string
  eventCount: number
  copy: MobileMonthGridCopy
}): string {
  const { dayYmd, eventCount, copy } = args

  return `${dayYmd}, ${eventCount} ${calendarItemLabel({
    count: eventCount,
    copy,
  })}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MonthEventDot(props: MonthEventDotProps) {
  const { event } = props

  return (
    <span
      className="brand-pro-calendar-month-dot"
      data-tone={calendarEventTone(event)}
      data-event-kind={event.kind}
      aria-hidden="true"
    />
  )
}

function MonthMoreDot(props: MonthMoreDotProps) {
  const { count } = props

  if (count <= 0) return null

  return (
    <span
      className="brand-pro-calendar-month-more"
      aria-label={`${count} more`}
    >
      +
    </span>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileMonthGrid(props: MobileMonthGridProps) {
  const {
    visibleDays,
    currentDate,
    events,
    timeZone,
    onPickDay,
    copy: copyOverride,
  } = props

  const copy = resolveCopy(copyOverride)

  const dayCells = useMemo(
    () =>
      buildMonthDayCells({
        visibleDays,
        currentDate,
        events,
        timeZone,
      }),
    [currentDate, events, timeZone, visibleDays],
  )

  const densityMap = useMemo(
    () =>
      buildMonthDensityMap({
        visibleDays,
        events,
        timeZone,
      }),
    [events, timeZone, visibleDays],
  )

  return (
    <section className="brand-pro-calendar-month-mobile">
      <div className="brand-pro-calendar-month-weekdays">
        {WEEKDAY_KEYS_DISPLAY.map((dayKey) => (
          <div key={dayKey} className="brand-pro-calendar-month-weekday">
            {weekdayLabel(dayKey)}
          </div>
        ))}
      </div>

      <div className="brand-pro-calendar-month-grid">
        {dayCells.map((cell) => {
          const density = monthDensityForDay({
            densityMap,
            dateKey: cell.dayYmd,
          })

          const visibleEvents = cell.events.slice(0, MAX_DOTS_PER_DAY)
          const extraCount = Math.max(
            0,
            density.totalCount - visibleEvents.length,
          )

          return (
            <button
              key={cell.dayYmd}
              type="button"
              onClick={() => onPickDay(cell.day)}
              className="brand-pro-calendar-month-cell brand-focus"
              data-today={cell.isToday ? 'true' : 'false'}
              data-current-month={cell.isInCurrentMonth ? 'true' : 'false'}
              data-has-events={density.totalCount > 0 ? 'true' : 'false'}
              data-density={density.density}
              data-booking-count={density.bookingCount}
              data-blocked-count={density.blockedCount}
              data-pending-count={density.pendingCount}
              aria-label={dayAriaLabel({
                dayYmd: cell.dayYmd,
                eventCount: density.totalCount,
                copy,
              })}
            >
              <div className="brand-pro-calendar-month-day">
                {cell.dayNumber}
              </div>

              {visibleEvents.length > 0 ? (
                <div className="brand-pro-calendar-month-dots">
                  {visibleEvents.map((event) => (
                    <MonthEventDot key={event.id} event={event} />
                  ))}

                  <MonthMoreDot count={extraCount} />
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="brand-pro-calendar-month-legend">
        <span className="brand-cap">{copy.todayLegend}</span>
        <span className="brand-cap">{copy.bookingsLegend}</span>
        <span className="brand-cap">{copy.swipeLegend}</span>
      </div>
    </section>
  )
}