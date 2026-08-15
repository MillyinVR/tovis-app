// app/client/_components/SectionCard.tsx
//
// The titled glass card the client detail screens are built from. Two pages had
// declared it separately — the booking detail page and the consultation token
// page — with the same surface, the same header layout and the same type scale.
//
// They were NOT byte-identical, and the difference is the reason this takes a
// prop instead of collapsing to one string: the booking card spaces its content
// `mt-3` and the consultation card `mt-4`. 4px, on a card that is otherwise the
// same card. Flattening that silently is the failure mode phase 4 shipped (every
// consolidated error reader quietly took the canonical's fallback string), so the
// difference is preserved and named rather than decided here.
// ⚠️ `gap="roomy"` exists to reproduce the consultation page, not because two
// spacings are intended. Which one is right is a design call.
//
// No `'use client'`: this is presentational, so it renders on the server for the
// booking page and travels into the bundle for the consultation page, which is a
// client component.
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** `tight` = mt-3 (the booking detail page). `roomy` = mt-4 (consultation). */
export type SectionCardGap = 'tight' | 'roomy'

export type SectionCardProps = {
  title: string
  subtitle?: string | null
  right?: ReactNode
  children: ReactNode
  className?: string
  gap?: SectionCardGap
}

const GAPS: Record<SectionCardGap, string> = {
  tight: 'mt-3',
  roomy: 'mt-4',
}

export default function SectionCard({
  title,
  subtitle,
  right,
  children,
  className,
  gap = 'tight',
}: SectionCardProps) {
  return (
    <section
      className={cn(
        'rounded-card border border-textPrimary/10 p-4 shadow-[0_14px_48px_rgb(var(--shadow-color)/0.18)]',
        'tovis-glass',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-black text-textPrimary">{title}</div>
          {subtitle ? (
            <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
              {subtitle}
            </div>
          ) : null}
        </div>

        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className={GAPS[gap]}>{children}</div>
    </section>
  )
}
