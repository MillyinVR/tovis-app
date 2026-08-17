// lib/brand/BrandWordmark.tsx
//
// The primary brand wordmark. For TOVIS this is the lowercase "tovis" set in
// the display face with the i-dot replaced by The Eye (the brand-sheet
// "the dot is the light" primary wordmark). For any other (white-label)
// brand it renders that brand's wordmark text, so the wordmark stays correct
// without per-tenant code.
//
// Color is inherited (currentColor) so the host controls text color/hover;
// the eye carries its own fixed plume gradient.
//
// This is THE white-label surface — it branches on the brand id to decide
// whether to draw the Eye or a tenant's own wordmark text — so it must read
// the tenant-resolved brand, not the deployment's NEXT_PUBLIC_BRAND. It takes
// it from the provider, which means it is a client component; it was already
// in the client bundle through AuthShell, and its server callers (PublicTopBar,
// PublicProfileView, BrandLoader) all render inside the root layout's
// BrandProvider.
'use client'

import type { CSSProperties } from 'react'
import { useBrand } from './BrandProvider'
import TovisEye from './TovisEye'

type BrandWordmarkProps = {
  /** Font size in px for the wordmark text; the eye scales from it. */
  size?: number
  className?: string
  style?: CSSProperties
}

export default function BrandWordmark({
  size = 30,
  className,
  style,
}: BrandWordmarkProps) {
  const { brand } = useBrand()

  const baseStyle: CSSProperties = {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: size,
    letterSpacing: '-0.05em',
    lineHeight: 1,
    ...style,
  }

  if (brand.id !== 'tovis') {
    return (
      <span className={className} style={baseStyle}>
        {brand.assets.wordmark.text}
      </span>
    )
  }

  const eye = Math.round(size * 0.34)
  const eyeTop = Math.round(size * 0.06)

  return (
    <span
      className={className}
      style={{ ...baseStyle, display: 'inline-flex', alignItems: 'baseline' }}
    >
      <span>tov</span>
      <span style={{ position: 'relative', display: 'inline-block' }}>
        {/* dotless i — the eye is the dot */}
        {'ı'}
        <TovisEye
          size={eye}
          style={{
            position: 'absolute',
            left: '50%',
            top: `-${eyeTop}px`,
            transform: 'translateX(-50%)',
          }}
        />
      </span>
      <span>s</span>
    </span>
  )
}
