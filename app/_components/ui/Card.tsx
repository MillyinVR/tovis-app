// app/_components/ui/Card.tsx
//
// Canonical surface/card primitive. Replaces the per-screen mix of p-3/p-4/p-[18px]
// padding and ~20 distinct shadow definitions with one padding scale + a small set
// of elevation tiers. Brand-token only (no raw colors) so it stays white-label-safe.
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type CardVariant = 'surface' | 'glass'
export type CardPadding = 'none' | 'sm' | 'md' | 'lg'
export type CardElevation = 'none' | 'sm' | 'md'

// Canonical padding scale. `md` (p-4 / 16px) is the converged default — it absorbs
// the client-home p-[18px] outlier; `sm` is for compact/nested tiles.
const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

// Elevation tiers (token-driven shadow color, so they tint per brand/mode).
const ELEVATION: Record<CardElevation, string> = {
  none: '',
  sm: 'shadow-[0_6px_20px_rgb(var(--shadow-color)/0.10)]',
  md: 'shadow-[0_16px_40px_rgb(var(--shadow-color)/0.14)]',
}

const VARIANTS: Record<CardVariant, string> = {
  surface: 'border border-textPrimary/10 bg-bgSurface',
  // Frosted floating surface — uses the surface-glass token border (not raw white)
  // so it respects [data-mode]; `tovis-glass` supplies the blur + gradient fill.
  glass: 'tovis-glass border border-surfaceGlass/15 bg-bgSecondary',
}

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article'
  variant?: CardVariant
  padding?: CardPadding
  elevation?: CardElevation
}

/** Canonical rounded surface. Pass `as="section"` for landmark sections. */
export default function Card({
  as: Tag = 'div',
  variant = 'surface',
  padding = 'md',
  elevation = 'none',
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        'rounded-card',
        VARIANTS[variant],
        PADDING[padding],
        ELEVATION[elevation],
        className,
      )}
      {...rest}
    />
  )
}
