// app/pro/calendar/_components/MonthGrid.tsx

'use client'

import type { CalendarEvent } from '../_types'
import { DAY_KEYS, isSameDay } from '../_utils/date'
import { eventChipClasses } from '../_utils/statusStyles'
import { isBlockedEvent } from '../_utils/calendarMath'

export function MonthGrid(props: {
  visibleDays: Date[]
  currentDate: Date
  events: CalendarEvent[]
  onPickDay: (d: Date) => void
}) {
  const { visibleDays, currentDate, events, onPickDay } = props

  function eventsForDay(day: Date) {
    return events.filter((ev) => isSameDay(new Date(ev.startsAt), day))
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
          const inMonth = d.getMonth() === currentDate.getMonth()
          const dayEvents = eventsForDay(d).slice(0, 2)
          const extra = Math.max(0, eventsForDay(d).length - dayEvents.length)

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
                <div className={['text-sm font-black', inMonth ? 'text-textPrimary' : 'text-textSecondary'].join(' ')}>{d.getDate()}</div>
                {isSameDay(d, new Date()) && (
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
                      className={['rounded-full px-3 py-1 text-xs truncate', eventChipClasses(ev)].join(' ')}
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
