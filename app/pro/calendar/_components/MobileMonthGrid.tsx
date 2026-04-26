// app/pro/calendar/_components/MobileMonthGrid.tsx
'use client'

import { useMemo } from 'react'

import type { CalendarEvent } from '../_types'

import { WEEKDAY_KEYS_DISPLAY } from '../_utils/date'
import { isBlockedEvent } from '../_utils/calendarMath'
import { buildMonthDayCells } from '../_utils/monthGrid'
import { eventStatusTone } from '../_utils/statusStyles'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobileMonthGridProps = {
  visibleDays: Date[]
  currentDate: Date
  events: CalendarEvent[]
  timeZone: string
  onPickDay: (day: Date) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DOTS_PER_DAY = 4

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function weekdayLabel(dayKey: string): string {
  return dayKey.slice(0, 1).toUpperCase()
}

function calendarEventTone(event: CalendarEvent): string {
  return eventStatusTone({
    status: event.status,
    isBlocked: isBlockedEvent(event),
  })
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobileMonthGrid(props: MobileMonthGridProps) {
  const { visibleDays, currentDate, events, timeZone, onPickDay } = props

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
          const visibleEvents = cell.events.slice(0, MAX_DOTS_PER_DAY)
          const extraCount = Math.max(0, cell.events.length - MAX_DOTS_PER_DAY)

          return (
            <button
              key={cell.dayYmd}
              type="button"
              onClick={() => onPickDay(cell.day)}
              className="brand-pro-calendar-month-cell brand-focus"
              data-today={cell.isToday ? 'true' : 'false'}
              data-current-month={cell.isInCurrentMonth ? 'true' : 'false'}
              aria-label={`${cell.dayYmd}, ${cell.events.length} calendar items`}
            >
              <div className="brand-pro-calendar-month-day">
                {cell.dayNumber}
              </div>

              {visibleEvents.length > 0 ? (
                <div className="brand-pro-calendar-month-dots">
                  {visibleEvents.map((event) => (
                    <span
                      key={event.id}
                      className="brand-pro-calendar-month-dot"
                      data-tone={calendarEventTone(event)}
                      aria-hidden="true"
                    />
                  ))}

                  {extraCount > 0 ? (
                    <span className="brand-pro-calendar-month-more">
                      +
                    </span>
                  ) : null}
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="brand-pro-calendar-month-legend">
        <span className="brand-cap">TODAY</span>
        <span className="brand-cap">BOOKINGS</span>
        <span className="brand-cap">SWIPE ← → FOR OTHER MONTHS</span>
      </div>
    </section>
  )
}