// app/pro/calendar/_components/_grid/NowLineSpan.tsx
'use client'

import type { CSSProperties } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type NowLineSpanProps = {
  topPx: number
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function rootStyle(topPx: number): CSSProperties {
  return {
    top: topPx,
    left: 0,
    width: 'var(--cal-time-col)',
  }
}

function haloStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--accent-primary) / 0.12)',
  }
}

function dotStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--accent-primary))',
    boxShadow: '0 0 10px rgb(var(--accent-primary-hover) / 0.75)',
  }
}

function ringStyle(): CSSProperties {
  return {
    boxShadow:
      '0 0 0 2px rgb(var(--bg-primary) / 0.70), 0 1px 2px rgb(0 0 0 / 0.18)',
  }
}

function highlightStyle(): CSSProperties {
  return {
    backgroundColor: 'rgb(var(--text-primary) / 0.35)',
  }
}

// ─── Exported component ───────────────────────────────────────────────────────

/**
 * Gutter "now" marker only.
 *
 * The across-grid line is rendered separately to avoid stacking-context issues.
 */
export function NowLineSpan(props: NowLineSpanProps) {
  const { topPx } = props

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-[9999]"
      style={rootStyle(topPx)}
      data-calendar-now-line-span="1"
    >
      <div className="relative flex items-center justify-end pr-2">
        <div
          className="absolute right-2 -top-2 h-5 w-5 rounded-full blur-xl"
          style={haloStyle()}
        />

        <div
          className="relative h-2.5 w-2.5 rounded-full"
          style={{
            ...dotStyle(),
            ...ringStyle(),
          }}
        >
          <div
            className="absolute left-[2px] top-[2px] h-1 w-1 rounded-full"
            style={highlightStyle()}
          />
        </div>
      </div>
    </div>
  )
}