// app/pro/calendar/_components/MonthGrid.tsx
'use client'

import type { CalendarEvent } from '../_types'
import { DAY_KEYS } from '../_utils/date'
import { isBlockedEvent } from '../_utils/calendarMath'
import { eventChipClassName } from '../_utils/statusStyles'
import { ymdInTimeZone } from '@/lib/timeZone'

const MIDDAY_MS = 12 * 60 * 60 * 1000

function stableYmdForVisibleDay(d: Date, timeZone: string) {
  return ymdInTimeZone(new Date(d.getTime() + MIDDAY_MS), timeZone)
}

export function MonthGrid(props: {
  visibleDays: Date[]
  currentDate: Date
  events: CalendarEvent[]
  timeZone: string
  onPickDay: (d: Date) => void
}) {
  const { visibleDays, currentDate, events, timeZone, onPickDay } = props

  const currentMonth = new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric', year: 'numeric' }).format(currentDate)

  function inCurrentMonth(day: Date) {
    const m = new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric', year: 'numeric' }).format(day)
    return m === currentMonth
  }

  function eventsForDay(day: Date) {
    const dayYmd = stableYmdForVisibleDay(day, timeZone)

    // include multi-day events (start..end inclusive) in that day bucket
    return events.filter((ev) => {
      const sMs = new Date(ev.startsAt).getTime()
      const eMs = new Date(ev.endsAt).getTime()
      if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs <= sMs) return false

      const startYmd = ymdInTimeZone(new Date(sMs), timeZone)
      const endYmd = ymdInTimeZone(new Date(eMs - 1), timeZone) // inclusive
      return dayYmd >= startYmd && dayYmd <= endYmd
    })
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary">
      <div className="grid grid-cols-7 border-b border-white/10 bg-bgSecondary">
        {DAY_KEYS.map((k) => (
          <div key={k} className="px-3 py-2 text-xs font-extrabold uppercase text-textSecondary">
            {k}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {visibleDays.map((d, idx) => {
          const inMonth = inCurrentMonth(d)
          const dayEvents = eventsForDay(d).slice(0, 2)
          const extra = Math.max(0, eventsForDay(d).length - dayEvents.length)

          const isToday = stableYmdForVisibleDay(d, timeZone) === ymdInTimeZone(new Date(), timeZone)

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onPickDay(d)}
              className={[
                'min-h-27.5 border-b border-white/10 p-3 text-left',
                (idx + 1) % 7 === 0 ? '' : 'border-r border-white/10',
                inMonth ? 'bg-bgPrimary' : 'bg-bgSecondary/40',
                'hover:bg-bgSecondary/60',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between">
                <div className={['text-sm font-black', inMonth ? 'text-textPrimary' : 'text-textSecondary'].join(' ')}>
                  {new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric' }).format(d)}
                </div>

                {isToday && (
                  <div className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-extrabold">
                    Today
                  </div>
                )}
              </div>

              <div className="mt-2 grid gap-2">
                {dayEvents.map((ev) => {
                  const isBlock = isBlockedEvent(ev)
                  return (
                    <div
                      key={ev.id}
                      className={[
                        'rounded-full px-3 py-1 text-xs truncate border shadow-sm backdrop-blur-md ring-1 ring-white/8',
                        eventChipClassName(ev),
                      ].join(' ')}
                      title={isBlock ? 'Blocked' : ev.title}
                    >
                      {isBlock ? 'Blocked' : ev.title}
                    </div>
                  )
                })}
                {extra > 0 && <div className="text-xs text-textSecondary">+{extra} more</div>}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
