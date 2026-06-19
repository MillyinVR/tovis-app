'use client'

import { cn } from '@/lib/utils'

type ToggleSize = 'sm' | 'md' | 'lg'

const SIZES: Record<
  ToggleSize,
  { track: string; knob: string; on: string; off: string }
> = {
  // sm: compact (per-look card). md: settings rows. lg: ≥44px tap target (sheets).
  // `on` = trackWidth − knobWidth − 4px; `off` = 4px. Knob is vertically centered.
  sm: { track: 'h-6 w-10', knob: 'h-4 w-4', on: 'left-5', off: 'left-1' },
  md: { track: 'h-7 w-12', knob: 'h-5 w-5', on: 'left-6', off: 'left-1' },
  lg: { track: 'h-11 w-[60px]', knob: 'h-7 w-7', on: 'left-7', off: 'left-1' },
}

/**
 * Brand-token toggle switch (theme-flipping, white-label safe). The single source
 * for the on/off pill used across client surfaces — pass `label` for the
 * accessible name and `size` for the tap-target footprint.
 */
export default function ToggleSwitch({
  checked,
  onChange,
  label,
  size = 'md',
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  size?: ToggleSize
  disabled?: boolean
}) {
  const s = SIZES[size]

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative shrink-0 rounded-full transition disabled:opacity-50',
        s.track,
        checked ? 'bg-accentPrimary' : 'bg-textPrimary/15',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 -translate-y-1/2 rounded-full bg-bgPrimary transition-all',
          s.knob,
          checked ? s.on : s.off,
        )}
      />
    </button>
  )
}
