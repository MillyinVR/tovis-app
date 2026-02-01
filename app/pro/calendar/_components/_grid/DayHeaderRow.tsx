// app/pro/calendar/_components/_grid/DayHeaderRow.tsx
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
      className="sticky top-0 z-30 grid border-b border-white/10 bg-bgSecondary/85 backdrop-blur"
      style={{ gridTemplateColumns: gridCols }}
    >
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
              isToday ? 'bg-accentPrimary/12' : 'bg-bgSecondary/40',
            ].join(' ')}
          >
            {isToday && (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-accentPrimary/60" />
                <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-accentPrimary/50" />
              </>
            )}

            <div className="text-[24px] font-semibold leading-none text-textPrimary">{day}</div>

            <div className={['mt-1 text-[12px] font-medium tracking-wide', isToday ? 'text-accentPrimary' : 'text-textSecondary'].join(' ')}>
              {weekday}
            </div>
          </div>
        )
      })}
    </div>
  )
}
