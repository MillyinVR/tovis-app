// app/u/[handle]/boards/[slug]/opengraph-image.tsx — share card for a public board
import { ImageResponse } from 'next/og'

import { svgToDataUrl, TOVIS_EYE_SVG } from '@/lib/brand/eyeSvg'
import { loadPublicBoard } from '@/lib/boards/publicBoard'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Board'

export default async function BoardOpengraphImage({
  params,
}: {
  params: { handle: string; slug: string }
}) {
  const [brand, board] = await Promise.all([
    getBrandForTenantContext(await resolveTenantContextForLayout()),
    loadPublicBoard(params.handle, params.slug),
  ])
  const markDataUrl = svgToDataUrl(brand.assets.mark.svg ?? TOVIS_EYE_SVG)

  const boardName = board?.boardName ?? 'Board'
  const handle = board?.handle ?? params.handle
  const lookCount = board?.looks.length ?? 0

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#0A1413',
          color: '#F2EFE7',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={markDataUrl} width={64} height={64} alt="" />
          <div style={{ fontSize: 30, fontWeight: 700, color: '#8FA39E' }}>
            {brand.assets.wordmark.text}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: 24,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#8FA39E',
            }}
          >
            Board · @{handle}
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
            }}
          >
            {boardName}
          </div>
          {lookCount > 0 ? (
            <div style={{ fontSize: 30, color: '#8FA39E' }}>
              {lookCount} {lookCount === 1 ? 'look' : 'looks'} to book
            </div>
          ) : null}
        </div>

        <div
          style={{
            width: 120,
            height: 6,
            borderRadius: 999,
            background: 'linear-gradient(100deg,#F2B43E,#15C9A8)',
          }}
        />
      </div>
    ),
    { ...size },
  )
}
