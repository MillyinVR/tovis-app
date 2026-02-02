'use client'

import { ymdInTimeZone } from '../../_utils/date'

const MIDDAY_MS = 12 * 60 * 60 * 1000

function stableYmdForVisibleDay(d: Date, timeZone: string) {
  return ymdInTimeZone(new Date(d.getTime() + MIDDAY_MS), timeZone)
}

function dayHeaderParts(date: Date, timeZone: string) {
  const safe = new Date(date.getTime() + MIDDAY_MS)
  const weekday = new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short' }).format(safe)
  const day = new Intl.DateTimeFormat(undefined, { timeZone, day: 'numeric' }).format(safe)
  return { weekday, day }
}

export function DayHeaderRow(props: {
  visibleDays: Date[]
  timeZone: string
  todayYmd: string
  gridCols: string
}) {
  const { visibleDays, timeZone, todayYmd, gridCols } = props

  return (
    <div
      className={[
        'sticky top-0 z-30 grid',
        'border-b border-white/10',
        // ✅ “paper header” strip: light but not gray/muddy
        'bg-white/6 backdrop-blur-md',
      ].join(' ')}
      style={{ gridTemplateColumns: gridCols }}
    >
      {/* gutter spacer */}
      <div className="h-20 border-r border-white/10" />

      {visibleDays.map((d, idx) => {
        const dayYmd = stableYmdForVisibleDay(d, timeZone)
        const isToday = dayYmd === todayYmd
        const { weekday, day } = dayHeaderParts(d, timeZone)

        return (
          <div
            key={idx}
            className={[
              'relative h-20 min-w-0 border-l border-white/10',
              'flex flex-col items-center justify-center',
              // ✅ keep non-today transparent so the CalendarShell “paper” reads
              isToday ? 'bg-white/8' : 'bg-transparent',
            ].join(' ')}
          >
            {/* soft top sheen (premium, not “gray bar”) */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/10 to-transparent" />

            {isToday ? (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-accentPrimary/60" />
                <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-accentPrimary/35" />
              </>
            ) : null}

            <div className="text-[24px] font-semibold leading-none text-textPrimary">{day}</div>

            <div
              className={[
                'mt-1 text-[12px] font-medium tracking-wide',
                isToday ? 'text-textPrimary' : 'text-textSecondary',
              ].join(' ')}
            >
              {weekday}
            </div>
          </div>
        )
      })}
    </div>
  )
}
