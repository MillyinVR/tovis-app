// app/_components/footer/RingCoin.tsx
'use client'

import type { CSSProperties, ReactNode } from 'react'

/**
 * The shared center primitive: an iridescent plume ring wrapping a dark,
 * sphere-shaded "app-coin". Used by the Looks feather mark and the Pro
 * live button. Pass `ring={false}` for a plain coin.
 */
export default function RingCoin({
  size,
  ring = true,
  children,
  style,
  className,
}: {
  size: number
  ring?: boolean
  children: ReactNode
  style?: CSSProperties
  className?: string
}) {
  return (
    <span
      className={className}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        padding: ring ? Math.max(2.5, Math.round(size * 0.045)) : 0,
        background: ring ? 'var(--plume)' : 'transparent',
        boxShadow: ring ? '0 14px 30px var(--tovis-acc-shadow)' : 'none',
        ...style,
      }}
    >
      <span
        style={{
          position: 'relative',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: 'var(--tovis-coin)',
        }}
      >
        {children}
      </span>
    </span>
  )
}
