// app/opengraph-image.tsx — branded social share card, generated from The Eye
// + the tenant-resolved brand name/tagline. Also serves as the Twitter image.
import { ImageResponse } from 'next/og'
import { TOVIS_EYE_DATA_URL } from '@/lib/brand/eyeSvg'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'tovis'

export default async function OpengraphImage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          background: '#0A1413',
          color: '#F2EFE7',
        }}
      >
        <img src={TOVIS_EYE_DATA_URL} width={172} height={172} alt="" />
        <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: '-0.04em' }}>
          {brand.assets.wordmark.text}
        </div>
        {brand.tagline ? (
          <div style={{ fontSize: 30, color: '#8FA39E' }}>{brand.tagline}</div>
        ) : null}
        <div
          style={{
            marginTop: 8,
            width: 96,
            height: 5,
            borderRadius: 999,
            background: 'linear-gradient(100deg,#F2B43E,#15C9A8)',
          }}
        />
      </div>
    ),
    { ...size },
  )
}
