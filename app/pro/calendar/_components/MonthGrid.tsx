// app/pro/calendar/_components/MonthGrid.tsx
'use client'

import { useMemo } from 'react'

import type { CalendarEvent } from '../_types'

import { WEEKDAY_KEYS_DISPLAY } from '../_utils/date'
import { isBlockedEvent } from '../_utils/calendarMath'
import { buildMonthDayCells } from '../_utils/monthGrid'
import { eventStatusTone, statusLabel } from '../_utils/statusStyles'

import {
  buildMonthDensityMap,
  monthDensityForDay,
} from '../_viewModel/monthDensity'

// ─── Types ────────────────────────────────────────────────────────────────────

type MonthGridProps = {
  visibleDays: Date[]
  currentDate: Date
  events: CalendarEvent[]
  timeZone: string
  onPickDay: (day: Date) => void

  /**
   * Bridge until desktop/tablet month-grid microcopy is moved into
   * BrandProCalendarCopy.
   */
  copy?: Partial<MonthGridCopy>
}

type MonthGridCopy = {
  blockedLabel: string
  todayLabel: string
  itemSingular: string
  itemPlural: string
  moreLabel: string
  openDayPrefix: string
}

type MonthEventChipProps = {
  event: CalendarEvent
  copy: MonthGridCopy
}

type MonthDayCountBadgeProps = {
  count: number
}

type MonthMoreCountProps = {
  count: number
  label: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_VISIBLE_EVENTS_PER_DAY = 3

const DEFAULT_COPY: MonthGridCopy = {
  blockedLabel: 'Blocked',
  todayLabel: 'Today',
  itemSingular: 'item',
  itemPlural: 'items',
  moreLabel: 'more',
  openDayPrefix: 'Open',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function resolveCopy(
  copy: Partial<MonthGridCopy> | undefined,
): MonthGridCopy {
  return {
    ...DEFAULT_COPY,
    ...copy,
  }
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function eventChipLabel(args: {
  event: CalendarEvent
  copy: MonthGridCopy
}): string {
  const { event, copy } = args

  if (isBlockedEvent(event)) return copy.blockedLabel

  const title = normalizeText(event.title)

  if (title) return title

  return statusLabel(event.status)
}

function weekdayLabel(dayKey: string): string {
  return dayKey.slice(0, 3).toUpperCase()
}

function itemLabel(args: {
  count: number
  copy: MonthGridCopy
}): string {
  const { count, copy } = args

  return count === 1 ? copy.itemSingular : copy.itemPlural
}

function eventCountLabel(args: {
  count: number
  copy: MonthGridCopy
}): string {
  const { count, copy } = args

  return `${count} ${itemLabel({ count, copy })}`
}

function monthEventTone(event: CalendarEvent): string {
  return eventStatusTone({
    status: event.status,
    isBlocked: isBlockedEvent(event),
  })
}

function dayButtonAriaLabel(args: {
  dayYmd: string
  eventCount: number
  copy: MonthGridCopy
}): string {
  const { dayYmd, eventCount, copy } = args

  return `${copy.openDayPrefix} ${dayYmd}, ${eventCountLabel({
    count: eventCount,
    copy,
  })}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MonthEventChip(props: MonthEventChipProps) {
  const { event, copy } = props
  const label = eventChipLabel({ event, copy })

  return (
    <div
      className="brand-pro-calendar-month-event-chip"
      data-tone={monthEventTone(event)}
      data-event-kind={event.kind}
      title={label}
    >
      {label}
    </div>
  )
}

function MonthDayCountBadge(props: MonthDayCountBadgeProps) {
  const { count } = props

  if (count <= 0) return null

  return (
    <span className="brand-pro-calendar-month-count" aria-hidden="true">
      {count}
    </span>
  )
}

function MonthMoreCount(props: MonthMoreCountProps) {
  const { count, label } = props

  if (count <= 0) return null

  return (
    <div className="brand-pro-calendar-month-more">
      +{count} {label}
    </div>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MonthGrid(props: MonthGridProps) {
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
    <section className="brand-pro-calendar-month-desktop-grid">
      <div className="brand-pro-calendar-month-desktop-weekdays">
        {WEEKDAY_KEYS_DISPLAY.map((dayKey) => (
          <div
            key={dayKey}
            className="brand-pro-calendar-month-desktop-weekday"
          >
            {weekdayLabel(dayKey)}
          </div>
        ))}
      </div>

      <div className="brand-pro-calendar-month-desktop-cells">
        {dayCells.map((cell, index) => {
          const density = monthDensityForDay({
            densityMap,
            dateKey: cell.dayYmd,
          })

          const visibleEvents = cell.events.slice(0, MAX_VISIBLE_EVENTS_PER_DAY)
          const extraCount = Math.max(
            0,
            density.totalCount - visibleEvents.length,
          )
          const isLastColumn = (index + 1) % 7 === 0

          return (
            <button
              key={cell.dayYmd}
              type="button"
              onClick={() => onPickDay(cell.day)}
              className="brand-pro-calendar-month-desktop-cell brand-focus"
              data-current-month={cell.isInCurrentMonth ? 'true' : 'false'}
              data-today={cell.isToday ? 'true' : 'false'}
              data-last-column={isLastColumn ? 'true' : 'false'}
              data-has-events={density.totalCount > 0 ? 'true' : 'false'}
              data-density={density.density}
              data-booking-count={density.bookingCount}
              data-blocked-count={density.blockedCount}
              data-pending-count={density.pendingCount}
              aria-label={dayButtonAriaLabel({
                dayYmd: cell.dayYmd,
                eventCount: density.totalCount,
                copy,
              })}
            >
              <div className="brand-pro-calendar-month-desktop-cell-header">
                <div>
                  <p className="brand-pro-calendar-month-desktop-day-number">
                    {cell.dayNumber}
                  </p>

                  {cell.isToday ? (
                    <p className="brand-pro-calendar-month-desktop-today-label">
                      {copy.todayLabel}
                    </p>
                  ) : null}
                </div>

                <MonthDayCountBadge count={density.totalCount} />
              </div>

              <div className="brand-pro-calendar-month-desktop-events">
                {visibleEvents.map((event) => (
                  <MonthEventChip
                    key={event.id}
                    event={event}
                    copy={copy}
                  />
                ))}

                <MonthMoreCount
                  count={extraCount}
                  label={copy.moreLabel}
                />
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}