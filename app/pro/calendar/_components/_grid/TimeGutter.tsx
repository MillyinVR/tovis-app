// app/pro/calendar/_components/_grid/TimeGutter.tsx
'use client'

import { useMemo } from 'react'
import { PX_PER_MINUTE } from '../../_utils/calendarMath'

function hourLabel(hour24: number) {
  const h = hour24 % 12
  const hour12 = h === 0 ? 12 : h
  const suffix = hour24 < 12 ? 'AM' : 'PM'
  return `${hour12} ${suffix}`
}

export function TimeGutter(props: { totalMinutes: number; timeZone: string }) {
  const { totalMinutes } = props
  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), [])

  return (
    <div
      className={[
        'relative',
        // ✅ inherit CalendarShell paper — don’t repaint it gray
        'bg-transparent',
        'border-r border-white/10',
      ].join(' ')}
    >
      {/* subtle top fade (still “paper”) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white/10 to-transparent" />

      {/* slight inner divider */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/10" />

      <div className="relative" style={{ height: totalMinutes * PX_PER_MINUTE }}>
        {hours.map((h) => (
          <div key={h} className="relative" style={{ height: 60 * PX_PER_MINUTE }}>
            <div
              className="absolute left-0 right-0 text-center text-[13px] font-semibold text-textSecondary"
              style={{ top: 2 }}
            >
              {hourLabel(h)}
            </div>

            {[15, 30, 45].map((min) => (
              <div
                key={min}
                className="absolute left-0 right-0 text-center text-[11px] font-medium text-textSecondary/45"
                style={{ top: min * PX_PER_MINUTE + 2 }}
              >
                {min}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
