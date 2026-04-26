// app/pro/calendar/_components/MonthGrid.tsx
'use client'

import { useMemo } from 'react'

import type { CalendarEvent } from '../_types'

import { WEEKDAY_KEYS_DISPLAY } from '../_utils/date'
import { isBlockedEvent } from '../_utils/calendarMath'
import { buildMonthDayCells } from '../_utils/monthGrid'
import { eventChipClassName, statusLabel } from '../_utils/statusStyles'

// ─── Types ────────────────────────────────────────────────────────────────────

type MonthGridProps = {
  visibleDays: Date[]
  currentDate: Date
  events: CalendarEvent[]
  timeZone: string
  onPickDay: (day: Date) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_VISIBLE_EVENTS_PER_DAY = 3

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function eventChipLabel(event: CalendarEvent): string {
  if (isBlockedEvent(event)) return 'Blocked'

  const title = event.title.trim()
  if (title) return title

  return statusLabel(event.status)
}

function weekdayLabel(dayKey: string): string {
  return dayKey.slice(0, 3).toUpperCase()
}

function dayCellClassName(args: {
  isLastColumn: boolean
  isInCurrentMonth: boolean
  isToday: boolean
}): string {
  const { isLastColumn, isInCurrentMonth, isToday } = args

  return [
    'group min-h-[6.75rem] border-b p-1.5 text-left transition',
    'sm:min-h-[8.5rem] sm:p-2.5',
    'border-[var(--line)]',
    isLastColumn ? '' : 'border-r',
    isInCurrentMonth
      ? 'bg-paper/[0.018] hover:bg-paper/[0.04]'
      : 'bg-black/20 text-paperMute hover:bg-black/10',
    isToday ? 'bg-terra/[0.08]' : '',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40 focus-visible:ring-inset',
  ].join(' ')
}

function dayNumberClassName(args: {
  isInCurrentMonth: boolean
  isToday: boolean
}): string {
  const { isInCurrentMonth, isToday } = args

  return [
    'font-display text-[22px] font-semibold leading-none tracking-[-0.04em]',
    'sm:text-2xl',
    isToday
      ? 'text-terra'
      : isInCurrentMonth
        ? 'text-paper'
        : 'text-paperMute',
  ].join(' ')
}

function eventCountLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MonthGrid(props: MonthGridProps) {
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
    <section
      className={[
        'overflow-hidden rounded-[18px] border border-[var(--line-strong)]',
        'bg-ink shadow-[0_28px_70px_rgb(0_0_0_/_0.38)]',
      ].join(' ')}
      data-calendar-month-grid="1"
    >
      <div className="grid grid-cols-7 border-b border-[var(--line-strong)] bg-paper/[0.03]">
        {WEEKDAY_KEYS_DISPLAY.map((dayKey) => (
          <div
            key={dayKey}
            className={[
              'px-1.5 py-2 text-center font-mono text-[8px] font-bold uppercase tracking-[0.12em]',
              'text-paperMute sm:px-3 sm:py-3 sm:text-[10px]',
            ].join(' ')}
          >
            {weekdayLabel(dayKey)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {dayCells.map((cell, index) => {
          const visibleEvents = cell.events.slice(0, MAX_VISIBLE_EVENTS_PER_DAY)
          const extraCount = Math.max(
            0,
            cell.events.length - visibleEvents.length,
          )
          const isLastColumn = (index + 1) % 7 === 0

          return (
            <button
              key={cell.dayYmd}
              type="button"
              onClick={() => onPickDay(cell.day)}
              className={dayCellClassName({
                isLastColumn,
                isInCurrentMonth: cell.isInCurrentMonth,
                isToday: cell.isToday,
              })}
              aria-label={`Open ${cell.dayYmd}, ${eventCountLabel(
                cell.events.length,
              )}`}
            >
              <div className="flex items-start justify-between gap-1.5">
                <div>
                  <p
                    className={dayNumberClassName({
                      isInCurrentMonth: cell.isInCurrentMonth,
                      isToday: cell.isToday,
                    })}
                  >
                    {cell.dayNumber}
                  </p>

                  {cell.isToday ? (
                    <p className="mt-1 font-mono text-[7px] font-black uppercase tracking-[0.12em] text-terraGlow sm:text-[8px]">
                      Today
                    </p>
                  ) : null}
                </div>

                {cell.events.length > 0 ? (
                  <span
                    className={[
                      'rounded-full border border-[var(--line)] px-1.5 py-0.5',
                      'font-mono text-[8px] font-black uppercase tracking-[0.06em]',
                      'text-paperMute',
                    ].join(' ')}
                  >
                    {cell.events.length}
                  </span>
                ) : null}
              </div>

              <div className="mt-2 grid gap-1 sm:mt-3 sm:gap-1.5">
                {visibleEvents.map((event) => {
                  const isBlocked = isBlockedEvent(event)
                  const label = eventChipLabel(event)

                  return (
                    <div
                      key={event.id}
                      className={[
                        'truncate rounded-full border px-1.5 py-0.5',
                        'text-[8px] font-semibold ring-1 backdrop-blur-md',
                        'sm:px-2.5 sm:py-1 sm:text-xs',
                        eventChipClassName({
                          status: event.status,
                          isBlocked,
                        }),
                      ].join(' ')}
                      title={label}
                    >
                      {label}
                    </div>
                  )
                })}

                {extraCount > 0 ? (
                  <div className="font-mono text-[8px] font-black uppercase tracking-[0.08em] text-paperMute sm:text-[10px]">
                    +{extraCount} more
                  </div>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}