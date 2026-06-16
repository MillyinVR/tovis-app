// app/apple-icon.tsx — iOS home-screen icon (PNG), from the tenant brand mark.
import { ImageResponse } from 'next/og'
import { svgToDataUrl, TOVIS_EYE_SVG } from '@/lib/brand/eyeSvg'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default async function AppleIcon() {
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
        <img src={markDataUrl} width={124} height={124} alt="" />
      </div>
    ),
    { ...size },
  )
}
