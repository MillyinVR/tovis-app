// app/pro/calendar/_components/_grid/CalendarShell.tsx
'use client'

import type React from 'react'

export function CalendarShell(props: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  gridCols: string
  children: React.ReactNode
  overlay?: React.ReactNode
}) {
  const { scrollRef, children, overlay } = props

  return (
    <section
      className={[
        // premium frame (glass OUTSIDE only)
        'tovis-glass-soft bg-transparent',
        'relative overflow-hidden rounded-2xl',
        'ring-1 ring-white/12',
        'shadow-2xl shadow-black/35',

        '[--cal-time-col:52px] md:[--cal-time-col:72px]',
        '[--cal-day-min:108px] sm:[--cal-day-min:120px] md:[--cal-day-min:150px] lg:[--cal-day-min:170px]',
      ].join(' ')}
    >
      <div
        ref={scrollRef}
        className="relative max-h-175 overflow-y-auto overscroll-contain scroll-smooth looksNoScrollbar"
      >
        <div className="relative">
          {/* ✅ INNER PAPER (stronger so it reads as “paper”, not “gray”) */}
          <div className="pointer-events-none absolute inset-0">
            {/* base paper */}
            <div className="absolute inset-0 bg-white/32" />

            {/* top sheen */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/18 via-transparent to-transparent" />

            {/* tiny vignette */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/12" />
          </div>

          {children}

          {overlay ? <div className="pointer-events-none absolute inset-0 z-50">{overlay}</div> : null}
        </div>
      </div>
    </section>
  )
}
