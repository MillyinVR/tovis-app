// app/_components/footer/LooksMark.tsx
'use client'

import Image from 'next/image'
import { getBrandConfig } from '@/lib/brand'
import RingCoin from './RingCoin'
import TovisFeatherMark from './TovisFeatherMark'

/**
 * The footer's raised center "Looks" mark. For the default brand this is the
 * signature feather (the Eye, with its plume gradient). White-label tenants
 * render their own brand mark on a tenant-adaptive coin instead — mirroring
 * how BrandWordmark falls back to brand.assets for non-default brands, so no
 * tenant ever ships the default-brand feather.
 */
export default function LooksMark({ size = 66 }: { size?: number }) {
  const brand = getBrandConfig()

  if (brand.id === 'tovis') {
    return <TovisFeatherMark size={size} />
  }

  const markSize = Math.round(size * 0.58)
  return (
    <RingCoin size={size} ringBackground="var(--cta)">
      <Image
        src={brand.assets.mark.src}
        alt={brand.assets.mark.alt}
        width={markSize}
        height={markSize}
        style={{ objectFit: 'contain' }}
      />
    </RingCoin>
  )
}
