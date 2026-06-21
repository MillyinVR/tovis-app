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

export type ButtonVariant = 'primary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'
export type ButtonShape = 'pill' | 'soft'

export type ButtonStyleOptions = {
  variant?: ButtonVariant
  size?: ButtonSize
  shape?: ButtonShape
  fullWidth?: boolean
  className?: string
}

const BASE =
  'inline-flex items-center justify-center font-display font-bold transition disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none'

// Canonical size scale (collapses the scattered text-[10/11/12/13]px set).
const SIZES: Record<ButtonSize, string> = {
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
  // Quiet, bordered action — the "Find a pro" / discover style.
  ghost:
    'border border-textPrimary/16 text-textSecondary hover:border-textPrimary/25',
  // Destructive, outlined so contrast stays safe across white-label brands.
  danger:
    'border border-toneDanger/40 text-toneDanger hover:bg-toneDanger/10',
}

/** Canonical button class string — for <Link>/<a> CTAs that can't be a <button>. */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  shape = 'pill',
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    BASE,
    SIZES[size],
    SHAPES[shape],
    VARIANTS[variant],
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
  fullWidth,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, shape, fullWidth, className })}
      {...rest}
    />
  )
}
