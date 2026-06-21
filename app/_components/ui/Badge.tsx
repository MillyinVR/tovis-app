// app/_components/ui/Badge.tsx
//
// Canonical status/label chip. The app scattered rounded-full <span> pills across
// screens (px-2/px-3, text-[10/11]px, ad-hoc border+text tone pairs); this is the
// single source of truth. Tone variants come from the tone utilities and brand
// tokens only (no raw colors), so chips stay white-label-safe and flip with
// [data-mode]. Border-tint + tone text (no heavy fill) keeps them legible on any
// surface across brands.
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'danger'
  | 'success'
  | 'warn'
  | 'info'
  | 'pending'
export type BadgeSize = 'sm' | 'md'

export type BadgeStyleOptions = {
  tone?: BadgeTone
  size?: BadgeSize
  className?: string
}

const BASE =
  'inline-flex items-center gap-1 rounded-full border font-display font-black whitespace-nowrap'

// Canonical size scale (collapses the scattered px-2/px-3 + text-[10/11]px set).
const SIZES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-3 py-1 text-[11px]',
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-textPrimary/12 text-textSecondary',
  accent: 'border-accentPrimary/30 text-textPrimary',
  danger: 'border-toneDanger/30 text-toneDanger',
  success: 'border-toneSuccess/30 text-toneSuccess',
  warn: 'border-toneWarn/30 text-toneWarn',
  info: 'border-toneInfo/30 text-toneInfo',
  pending: 'border-tonePending/30 text-tonePending',
}

/** Canonical badge class string — for cases that can't render the <Badge> span. */
export function badgeClassName({
  tone = 'neutral',
  size = 'md',
  className,
}: BadgeStyleOptions = {}): string {
  return cn(BASE, SIZES[size], TONES[tone], className)
}

export type BadgeProps = BadgeStyleOptions & HTMLAttributes<HTMLSpanElement>

/** Canonical status/label pill. */
export default function Badge({
  tone,
  size,
  className,
  ...rest
}: BadgeProps) {
  return <span className={badgeClassName({ tone, size, className })} {...rest} />
}
