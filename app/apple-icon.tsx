// app/apple-icon.tsx — iOS home-screen icon (PNG) generated from The Eye.
import { ImageResponse } from 'next/og'
import { TOVIS_EYE_DATA_URL } from '@/lib/brand/eyeSvg'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
        <img src={TOVIS_EYE_DATA_URL} width={124} height={124} alt="" />
      </div>
    ),
    { ...size },
  )
}
