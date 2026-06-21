// app/_components/ui/Avatar.tsx
//
// Canonical avatar primitive. Replaces hand-rolled avatars (client h-[46px]
// squircles vs pro/looks h-10 circles vs the pro-calendar bare-initials chip) with
// one circle-everywhere shape, a fixed size scale, and the shared initials logic
// from lib/initials. Brand-token gradient fill keeps it white-label-safe.
import { initialsForName } from '@/lib/initials'
import { gradientAvatar } from '@/app/client/(gated)/_components/homeVisuals'
import RemoteImage from '@/app/_components/media/RemoteImage'

import { cn } from '@/lib/utils'

export type AvatarSize = 'sm' | 'md' | 'lg'
export type AvatarFill = 'gradient' | 'neutral'

// Canonical size scale (px footprint feeds RemoteImage width/height).
const SIZES: Record<AvatarSize, { box: string; text: string; px: number }> = {
  sm: { box: 'h-9 w-9', text: 'text-[11px]', px: 36 },
  md: { box: 'h-10 w-10', text: 'text-xs', px: 40 },
  lg: { box: 'h-12 w-12', text: 'text-[13px]', px: 48 },
}

export type AvatarProps = {
  /** Display name — used for the initials fallback and image alt text. */
  name?: string
  /** Avatar image; falls back to initials when absent. */
  src?: string | null
  /** Explicit initials override (e.g. pre-computed for blocked/placeholder rows). */
  initials?: string
  /** Cycles the gradient fill for visual variety across a list. */
  index?: number
  size?: AvatarSize
  fill?: AvatarFill
  className?: string
  /** Hide from the a11y tree when the name is already announced nearby. */
  'aria-hidden'?: boolean
}

/** Circle avatar with a brand-gradient (or neutral) fallback behind initials. */
export default function Avatar({
  name,
  src,
  initials,
  index = 0,
  size = 'md',
  fill = 'gradient',
  className,
  'aria-hidden': ariaHidden,
}: AvatarProps) {
  const s = SIZES[size]
  const label = initials ?? (name ? initialsForName(name) : '?')
  const isGradient = fill === 'gradient'

  return (
    <div
      aria-hidden={ariaHidden}
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full font-bold',
        s.box,
        s.text,
        isGradient
          ? 'text-onCta'
          : 'border border-surfaceGlass/15 bg-bgSecondary text-textPrimary',
        className,
      )}
      style={isGradient ? { background: gradientAvatar(index) } : undefined}
    >
      {src ? (
        <RemoteImage
          src={src}
          alt={name ?? ''}
          className="h-full w-full object-cover"
          width={s.px}
          height={s.px}
        />
      ) : (
        label
      )}
    </div>
  )
}
