// app/pro/calendar/_components/_grid/CalendarShell.tsx
'use client'

import type { ReactNode, RefObject } from 'react'

type CalendarShellProps = {
  scrollRef: RefObject<HTMLDivElement | null>
  gridCols: string
  children: ReactNode
  overlay?: ReactNode
}

export function CalendarShell(props: CalendarShellProps) {
  const { scrollRef, gridCols, children, overlay } = props

  return (
    <section
      className={[
        'relative overflow-hidden rounded-[18px]',
        'border border-[var(--line-strong)] bg-[var(--ink)]',
        'shadow-[0_28px_70px_rgb(0_0_0/0.42)]',
        '[--cal-time-col:52px] md:[--cal-time-col:72px]',
        '[--cal-day-min:116px] sm:[--cal-day-min:132px] md:[--cal-day-min:148px] lg:[--cal-day-min:164px]',
      ].join(' ')}
      data-calendar-shell="1"
    >
      <div
        ref={scrollRef}
        className={[
          'relative max-h-[calc(100vh-16rem)] min-h-[520px]',
          'overflow-auto overscroll-contain scroll-smooth',
          'looksNoScrollbar',
        ].join(' ')}
        data-calendar-scroll="1"
      >
        <div
          className={[
            'relative min-w-[calc(var(--cal-time-col)+(var(--cal-day-min)*1))]',
            'bg-[var(--ink)]',
            'md:min-w-[calc(var(--cal-time-col)+(var(--cal-day-min)*3))]',
            'lg:min-w-0',
          ].join(' ')}
          data-calendar-surface="1"
        >
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
          >
            <div className="absolute inset-0 bg-[var(--paper)]/[0.025]" />
            <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[var(--paper)]/[0.06] to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/20 to-transparent" />
          </div>

          <div className="relative z-10">{children}</div>

          {overlay ? (
            <div
              className="pointer-events-none absolute inset-0 z-50"
              aria-hidden="true"
            >
              {overlay}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}