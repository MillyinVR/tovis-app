// lib/brand/TovisEye.tsx
//
// "The Eye" — the tovis peacock-ocellus mark from the brand sheet. A leaf /
// aperture of light with a gold core radiating through teal, blue, and iris,
// plus a cream glint. Brand-constant (the plume gradient), so this is the
// TOVIS mark specifically; white-label tenants render their own
// brand.assets.mark image instead.
import type { CSSProperties } from 'react'

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
      <defs>
        <radialGradient id={gradientId} cx="48%" cy="40%" r="64%">
          <stop offset="0%" stopColor="#FFF0C2" />
          <stop offset="20%" stopColor="#F2B43E" />
          <stop offset="46%" stopColor="#15C9A8" />
          <stop offset="72%" stopColor="#1574C4" />
          <stop offset="100%" stopColor="#6B4BE6" />
        </radialGradient>
      </defs>
      <path
        d="M50 4 C78 27 78 73 50 96 C22 73 22 27 50 4 Z"
        fill={`url(#${gradientId})`}
      />
      <circle cx="42" cy="38" r="6.5" fill="#FFF6E2" />
    </svg>
  )
}
