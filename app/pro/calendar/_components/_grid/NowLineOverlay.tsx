// app/pro/calendar/_components/_grid/NowLineOverlay.tsx
'use client'

type NowLineOverlayProps = {
  topPx: number
  show: boolean
  nowLabel?: string
}

export function NowLineOverlay(props: NowLineOverlayProps) {
  const { topPx, show, nowLabel } = props
  if (!show) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 z-[999]"
      style={{ top: topPx }}
    >
      <div
        className="grid items-center"
        style={{ gridTemplateColumns: 'var(--cal-time-col) 1fr' }}
      >
        <div />

        <div className="relative">
          <div
            className={[
              'absolute -left-[5px] -top-[5px]',
              'h-2.5 w-2.5 rounded-full',
              'bg-terra shadow-[0_0_10px_rgb(var(--terra-glow)/0.9)]',
            ].join(' ')}
          />

          <div
            className={[
              'h-0.5 w-full',
              'bg-terra shadow-[0_0_12px_rgb(var(--terra-glow)/0.7)]',
            ].join(' ')}
          />

          {nowLabel !== undefined ? (
            <div
              className={[
                'absolute -top-5 right-2',
                'rounded-sm bg-terra px-1.5 py-px',
                'font-mono text-[9px] font-black uppercase tracking-[0.08em] text-[var(--paper)]',
              ].join(' ')}
            >
              NOW · {nowLabel}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
