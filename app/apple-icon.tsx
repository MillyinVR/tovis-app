// app/apple-icon.tsx — iOS home-screen icons (PNG), from the tenant brand mark.
import { ImageResponse } from 'next/og'
import { svgToDataUrl, TOVIS_EYE_SVG } from '@/lib/brand/eyeSvg'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const contentType = 'image/png'

// apple-touch-icon sizes Next emits as <link> tags:
// 180 = iPhone @3x (modern), 167 = iPad Pro, 120 = iPhone @2x (older).
const SIZES = [120, 167, 180] as const

// Keep the brand mark at the same proportion it had on the original 180px canvas.
const MARK_RATIO = 124 / 180

export function generateImageMetadata() {
  return SIZES.map((px) => ({
    id: String(px),
    size: { width: px, height: px },
    contentType,
  }))
}

export default async function AppleIcon({ id }: { id: Promise<string> }) {
  const px = Number(await id)
  const markPx = Math.round(px * MARK_RATIO)

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const markDataUrl = svgToDataUrl(brand.assets.mark.svg ?? TOVIS_EYE_SVG)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A1413',
        }}
      >
        <img src={markDataUrl} width={markPx} height={markPx} alt="" />
      </div>
    ),
    { width: px, height: px },
  )
}
