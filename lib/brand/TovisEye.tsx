// lib/brand/TovisEye.tsx
//
// "The Eye" — the tovis peacock-ocellus mark from the brand sheet. A leaf /
// aperture of light with a gold core radiating through teal, blue, and iris,
// plus a cream glint. Brand-constant (the plume gradient), so this is the
// TOVIS mark specifically; white-label tenants render their own
// brand.assets.mark image instead.
//
// The artwork itself lives in lib/brand/eyeSvg.ts — this file draws it, it
// does not define it. See that file for why.
import type { CSSProperties } from 'react'

import {
  TOVIS_EYE_GLINT,
  TOVIS_EYE_GRADIENT,
  TOVIS_EYE_PATH,
  TOVIS_EYE_STOPS,
} from './eyeSvg'

/**
 * The plume gradient's <defs>, shared by every React rendering of the mark
 * (this component, the footer's feather, the loading splash). The caller owns
 * the id so a page can carry several without them colliding.
 */
export function TovisEyeGradient({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={id} {...TOVIS_EYE_GRADIENT}>
        {TOVIS_EYE_STOPS.map((stop) => (
          <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
        ))}
      </radialGradient>
    </defs>
  )
}

type TovisEyeProps = {
  size?: number
  /** When provided, the mark is exposed to AT with this label; otherwise hidden. */
  title?: string
  style?: CSSProperties
  /**
   * SVG gradient id. Defaults to a shared id — duplicate ids on a page still
   * resolve to the same gradient, so collisions are visually harmless. Pass a
   * unique id when you need strict isolation.
   */
  gradientId?: string
}

export default function TovisEye({
  size = 28,
  title,
  style,
  gradientId = 'tovisEye',
}: TovisEyeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <TovisEyeGradient id={gradientId} />
      <path d={TOVIS_EYE_PATH} fill={`url(#${gradientId})`} />
      <circle
        cx={TOVIS_EYE_GLINT.cx}
        cy={TOVIS_EYE_GLINT.cy}
        r={TOVIS_EYE_GLINT.r}
        fill={TOVIS_EYE_GLINT.color}
      />
    </svg>
  )
}
