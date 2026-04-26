// app/pro/calendar/_components/_grid/CalendarShell.tsx
'use client'

import type { CSSProperties, ReactNode, RefObject } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarShellProps = {
  scrollRef: RefObject<HTMLDivElement | null>
  children: ReactNode
  overlay?: ReactNode
  minDayWidth?: 'compact' | 'comfortable'
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function shellClassName(): string {
  return [
    'relative overflow-hidden border-y',
    'md:rounded-[18px] md:border',
    'md:shadow-[0_28px_70px_rgb(0_0_0_/_0.42)]',
    '[--cal-time-col:32px] md:[--cal-time-col:72px]',
  ].join(' ')
}

function surfaceClassName(minDayWidth: 'compact' | 'comfortable'): string {
  const minWidthClass =
    minDayWidth === 'comfortable'
      ? [
          'min-w-[calc(var(--cal-time-col)+(148px*1))]',
          'md:min-w-[calc(var(--cal-time-col)+(164px*3))]',
          'lg:min-w-0',
        ].join(' ')
      : [
          'min-w-[calc(var(--cal-time-col)+(116px*1))]',
          'md:min-w-[calc(var(--cal-time-col)+(132px*3))]',
          'lg:min-w-0',
        ].join(' ')

  return ['relative', minWidthClass].join(' ')
}

function shellStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--bg-primary))',
    borderColor: 'rgb(var(--surface-glass) / 0.12)',
  }
}

function surfaceStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--bg-primary))',
  }
}

function softWashStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--surface-glass) / 0.025)',
  }
}

function topFadeStyle(): CSSProperties {
  return {
    background:
      'linear-gradient(to bottom, rgb(var(--surface-glass) / 0.06), transparent)',
  }
}

function bottomFadeStyle(): CSSProperties {
  return {
    background: 'linear-gradient(to top, rgb(0 0 0 / 0.20), transparent)',
  }
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarShell(props: CalendarShellProps) {
  const {
    scrollRef,
    children,
    overlay,
    minDayWidth = 'compact',
  } = props

  return (
    <section
      className={shellClassName()}
      style={shellStyle()}
      data-calendar-shell="1"
    >
      <div
        ref={scrollRef}
        className={[
          'relative h-[calc(100dvh-17rem)] min-h-[430px]',
          'overflow-auto overscroll-contain scroll-smooth',
          'md:max-h-[calc(100vh-16rem)] md:min-h-[520px]',
          'looksNoScrollbar',
        ].join(' ')}
        data-calendar-scroll="1"
      >
        <div
          className={surfaceClassName(minDayWidth)}
          style={surfaceStyle()}
          data-calendar-surface="1"
        >
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
          >
            <div className="absolute inset-0" style={softWashStyle()} />
            <div className="absolute inset-x-0 top-0 h-40" style={topFadeStyle()} />
            <div className="absolute inset-x-0 bottom-0 h-32" style={bottomFadeStyle()} />
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