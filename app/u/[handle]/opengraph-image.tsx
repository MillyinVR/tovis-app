// app/u/[handle]/opengraph-image.tsx — share card for a public creator profile
// (social-first D3). Text + brand mark only (no remote image fetch) so the card
// always renders even when a stored avatar/look URL is unavailable.
import { ImageResponse } from 'next/og'

import {
  rgbTripletToHex,
  svgToDataUrl,
  TOVIS_EYE_SVG,
} from '@/lib/brand/eyeSvg'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { loadPublicClientProfile } from './_data/loadPublicClientProfile'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Creator profile'

export default async function ProfileOpengraphImage({
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle: handleParam } = await params

  const [brand, profile] = await Promise.all([
    getBrandForTenantContext(await resolveTenantContextForLayout()),
    loadPublicClientProfile(handleParam),
  ])
  const markDataUrl = svgToDataUrl(brand.assets.mark.svg ?? TOVIS_EYE_SVG)
  const dark = brand.tokensByMode.dark.colors

  const handle = profile?.handle ?? handleParam
  const bio = profile?.bio ?? null
  const lookCount = profile?.counts.looks ?? 0
  const followerCount = profile?.counts.followers ?? 0

  const stats = [
    `${lookCount} ${lookCount === 1 ? 'look' : 'looks'}`,
    `${followerCount} ${followerCount === 1 ? 'follower' : 'followers'}`,
  ].join('   ·   ')

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1.02,
            }}
          >
            {`@${handle}`}
          </div>
          {bio ? (
            <div
              style={{
                fontSize: 34,
                color: rgbTripletToHex(dark.textSecondary),
                maxWidth: 900,
                lineHeight: 1.25,
              }}
            >
              {bio.length > 120 ? `${bio.slice(0, 117)}…` : bio}
            </div>
          ) : null}
          <div style={{ fontSize: 30, color: rgbTripletToHex(dark.textMuted) }}>{stats}</div>
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
