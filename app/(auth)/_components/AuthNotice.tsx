// app/(auth)/_components/AuthNotice.tsx
//
// The one banner the auth screens use for errors and inline notices — every
// screen used to hand-roll the identical div. Placement rule (Tori,
// 2026-08-23): a notice reporting the outcome of a pressed control renders
// DIRECTLY ABOVE that control, not at the top of the screen and not below the
// buttons.

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type AuthNoticeTone = 'danger' | 'warn' | 'accent' | 'success'

const TONE_CLASSES: Record<AuthNoticeTone, string> = {
  danger: 'border-toneDanger/25 bg-toneDanger/10 text-toneDanger',
  warn: 'border-toneWarn/25 bg-toneWarn/10 text-toneWarn',
  accent: 'border-accentPrimary/25 bg-accentPrimary/10 text-textPrimary',
  success: 'border-toneSuccess/30 bg-toneSuccess/10 text-textPrimary',
}

export default function AuthNotice({
  tone,
  children,
  className,
}: {
  tone: AuthNoticeTone
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-card border px-3 py-2 text-sm font-bold',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </div>
  )
}
