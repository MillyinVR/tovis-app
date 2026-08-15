// app/_components/ui/Button.tsx
//
// Canonical button primitive. The app historically re-invented buttons per screen
// (heights, radii, and text sizes scattered across ~25 bespoke patterns); this is
// the single source of truth for CTA styling. Brand-token only (no raw colors) so
// it stays white-label-safe and flips with [data-mode].
//
// The app-wide norm is a pill (rounded-full); `shape="soft"` opts into the
// rounded-[14px] soft rectangle that the client-home design intends. Link CTAs
// (Next.js <Link>) can't be a <button>, so they consume `buttonClassName(...)`
// directly — same canonical scale, no duplicated class strings.
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type ButtonVariant =
  | 'primary'
  | 'accent'
  | 'neutral'
  | 'ghost'
  | 'danger'
  | 'success'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'
export type ButtonShape = 'pill' | 'soft'
/**
 * `none` is the outlined button this file shipped with. `soft` adds the resting
 * tinted fill the admin buttons had re-authored by hand — mirrors Badge's `fill`,
 * and without it those forks would have lost their background on migration.
 */
export type ButtonFill = 'none' | 'soft'

export type ButtonStyleOptions = {
  variant?: ButtonVariant
  size?: ButtonSize
  shape?: ButtonShape
  fill?: ButtonFill
  fullWidth?: boolean
  className?: string
}

const BASE =
  'inline-flex items-center justify-center font-display font-bold transition disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none'

// Canonical size scale (collapses the scattered text-[10/11/12/13]px set).
// `xs` is for the compact inline buttons that sit alongside chips/counts (the
// old per-screen `px-3 py-1.5 text-[11px]` mini-buttons).
const SIZES: Record<ButtonSize, string> = {
  xs: 'h-8 px-3 text-[11px]',
  sm: 'h-9 px-4 text-[12px]',
  md: 'h-11 px-5 text-[13.5px]',
  lg: 'h-[46px] px-6 text-[14px]',
}

const SHAPES: Record<ButtonShape, string> = {
  pill: 'rounded-full',
  soft: 'rounded-[14px]',
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Brand gradient CTA on ink text, with the canonical accent glow.
  primary:
    'bg-cta text-onCta shadow-[0_6px_20px_rgb(var(--accent-primary)/0.24)] hover:opacity-95',
  // Accent-toned action — the admin "Save"/"Grant" weight: reads as the primary
  // action of a form without competing with the page's gradient CTA.
  accent:
    'border border-accentPrimary/45 text-accentPrimary hover:border-accentPrimary/60',
  // Secondary action on a raised surface — the admin "Cancel"/"Edit" weight.
  neutral:
    'border border-surfaceGlass/14 text-textPrimary hover:border-surfaceGlass/25',
  // Quiet, bordered action — the "Find a pro" / discover style.
  ghost:
    'border border-textPrimary/16 text-textSecondary hover:border-textPrimary/25',
  // Destructive, outlined so contrast stays safe across white-label brands.
  danger:
    'border border-toneDanger/40 text-toneDanger hover:bg-toneDanger/10',
  // Affirmative action (e.g. "Mark done") — outlined to match danger's weight.
  success:
    'border border-toneSuccess/40 text-toneSuccess hover:bg-toneSuccess/10',
}

// Resting fills. `primary` is already filled, so `soft` is a no-op there.
const FILLS: Record<ButtonVariant, string> = {
  primary: '',
  accent: 'bg-accentPrimary/15 hover:bg-accentPrimary/20',
  neutral: 'bg-bgSecondary hover:bg-surfaceGlass/6',
  ghost: 'bg-bgSecondary',
  danger: 'bg-toneDanger/10 hover:bg-toneDanger/15',
  success: 'bg-toneSuccess/10 hover:bg-toneSuccess/15',
}

/** Canonical button class string — for <Link>/<a> CTAs that can't be a <button>. */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  shape = 'pill',
  fill = 'none',
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    BASE,
    SIZES[size],
    SHAPES[shape],
    VARIANTS[variant],
    fill === 'soft' && FILLS[variant],
    fullWidth && 'w-full',
    className,
  )
}

export type ButtonProps = ButtonStyleOptions &
  ButtonHTMLAttributes<HTMLButtonElement>

/** Canonical <button>. For link CTAs, use `buttonClassName(...)` on the <Link>. */
export default function Button({
  variant,
  size,
  shape,
  fill,
  fullWidth,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({
        variant,
        size,
        shape,
        fill,
        fullWidth,
        className,
      })}
      {...rest}
    />
  )
}
