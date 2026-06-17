// app/pro/migrate/_components/StatusChip.tsx

import type { ReactNode } from 'react'

export type ChipVariant =
  | 'accent' // confirmed / matched / success
  | 'gold' // pending / attention
  | 'warn' // error / missing
  | 'muted' // skipped / excluded
  | 'violet' // tertiary / dupe

type Props = {
  variant: ChipVariant
  children: ReactNode
  hint?: string
}

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  accent: 'bg-accentPrimary/12 text-accentPrimary ring-accentPrimary/30',
  gold: 'bg-amber/12 text-amber ring-amber/30',
  warn: 'bg-ember/12 text-ember ring-ember/30',
  muted: 'bg-white/5 text-textMuted ring-white/10',
  violet: 'bg-acid/12 text-acid ring-acid/30',
}

export function StatusChip({ variant, children, hint }: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={[
          'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1',
          VARIANT_CLASSES[variant],
        ].join(' ')}
      >
        {children}
      </span>
      {hint ? <span className="text-[12px] text-textMuted">{hint}</span> : null}
    </span>
  )
}
