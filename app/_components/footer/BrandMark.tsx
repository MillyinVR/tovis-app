// app/_components/footer/BrandMark.tsx
'use client'

import Image from 'next/image'
import { getBrandConfig } from '@/lib/brand'
import TovisEye from '@/lib/brand/TovisEye'

/**
 * The bare brand mark (no ring/coin) for inline icon contexts — e.g. the
 * footer "Looks" tab. Mirrors LooksMark's brand split: the default brand
 * renders the signature feather (the Eye), white-label tenants render their
 * own brand.assets.mark, so no tenant ever ships the default-brand feather.
 */
export default function BrandMark({
  size = 22,
  title,
}: {
  size?: number
  title?: string
}) {
  const brand = getBrandConfig()

  if (brand.id === 'tovis') {
    return <TovisEye size={size} title={title} />
  }

  return (
    <Image
      src={brand.assets.mark.src}
      alt={title ?? brand.assets.mark.alt}
      width={size}
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}
