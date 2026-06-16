// app/manifest.ts — PWA manifest, resolved from the tenant's brand.
import type { MetadataRoute } from 'next'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { rgbTripletToHex } from '@/lib/brand/eyeSvg'

export const dynamic = 'force-dynamic'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const dark = brand.tokensByMode.dark.colors

  return {
    name: brand.displayName,
    short_name: brand.displayName,
    description: brand.tagline ?? brand.displayName,
    start_url: '/',
    display: 'standalone',
    background_color: rgbTripletToHex(dark.bgPrimary),
    theme_color: rgbTripletToHex(dark.bgPrimary),
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon', type: 'image/png', sizes: '180x180' },
    ],
  }
}
