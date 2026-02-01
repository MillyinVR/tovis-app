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
        // premium surface: glass + subtle ring
        'tovis-glass-soft',
        'relative overflow-hidden rounded-2xl',
        'ring-1 ring-white/10',
        'shadow-2xl shadow-black/30',

        // time gutter width tokens
        '[--cal-time-col:52px] md:[--cal-time-col:72px]',

        // ✅ minimum day width (this is the “Vagaro readability” lever)
        // tweak these until it feels right
        '[--cal-day-min:108px] sm:[--cal-day-min:120px] md:[--cal-day-min:150px] lg:[--cal-day-min:170px]',
      ].join(' ')}
    >
      <div
        ref={scrollRef}
        className={[
          'max-h-175 overflow-y-auto overscroll-contain',
          'scroll-smooth',
          'looksNoScrollbar',
          'relative',
        ].join(' ')}
      >
        {/* This wrapper ensures overlay scrolls with the content */}
        <div className="relative">
          {children}

          {/* Overlay layer (scrolls with content) */}
          {overlay ? <div className="pointer-events-none absolute inset-0 z-50">{overlay}</div> : null}
        </div>
      </div>
    </section>
  )
}
