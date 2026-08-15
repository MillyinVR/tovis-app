// app/u/[handle]/boards/[slug]/opengraph-image.tsx — share card for a public board
import { ImageResponse } from 'next/og'

import {
  rgbTripletToHex,
  svgToDataUrl,
  TOVIS_EYE_SVG,
} from '@/lib/brand/eyeSvg'
import { loadPublicBoard } from '@/lib/boards/publicBoard'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Board'

export default async function BoardOpengraphImage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle: handleParam, slug } = await params

  const [brand, board] = await Promise.all([
    getBrandForTenantContext(await resolveTenantContextForLayout()),
    loadPublicBoard(handleParam, slug),
  ])
  const markDataUrl = svgToDataUrl(brand.assets.mark.svg ?? TOVIS_EYE_SVG)
  const dark = brand.tokensByMode.dark.colors

  const boardName = board?.boardName ?? 'Board'
  const handle = board?.handle ?? handleParam
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
          background: rgbTripletToHex(dark.bgPrimary),
          color: rgbTripletToHex(dark.textPrimary),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={markDataUrl} width={64} height={64} alt="" />
          <div style={{ fontSize: 30, fontWeight: 700, color: rgbTripletToHex(dark.textMuted) }}>
            {brand.assets.wordmark.text}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: 24,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: rgbTripletToHex(dark.textMuted),
            }}
          >
            {`Board · @${handle}`}
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
            <div style={{ fontSize: 30, color: rgbTripletToHex(dark.textMuted) }}>
              {`${lookCount} ${lookCount === 1 ? 'look' : 'looks'} to book`}
            </div>
          ) : null}
        </div>

        <div
          style={{
            width: 120,
            height: 6,
            borderRadius: 999,
            background: `linear-gradient(100deg,${rgbTripletToHex(
              dark.microAccent,
            )},${rgbTripletToHex(dark.accentPrimary)})`,
          }}
        />
      </div>
    ),
    { ...size },
  )
}
