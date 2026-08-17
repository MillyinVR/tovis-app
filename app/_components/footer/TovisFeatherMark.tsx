// app/_components/footer/TovisFeatherMark.tsx
'use client'

import { useId } from 'react'

import { TOVIS_EYE_PATH } from '@/lib/brand/eyeSvg'
import { TovisEyeGradient } from '@/lib/brand/TovisEye'

import RingCoin from './RingCoin'

/**
 * The Looks center mark: the tovis feather (the Eye, pupil dropped so it
 * reads as a luminous aperture rather than a cat's eye) inside the ring +
 * sphere coin, with a soft jewel-tinted orb of light drifting through it.
 *
 * Dropping the glint is this mark's own choice; the plume comes from the
 * shared artwork so it cannot drift from the mark it is a variant of.
 */
export default function TovisFeatherMark({
  size = 66,
  featherSize,
}: {
  size?: number
  featherSize?: number
}) {
  const raw = useId()
  const gid = `tovis-feather-${raw.replace(/[^a-zA-Z0-9]/g, '')}`
  const fSize = featherSize ?? Math.round(size * 0.66)

  return (
    <RingCoin size={size}>
      <svg
        width={fSize}
        height={fSize}
        viewBox="0 0 100 100"
        style={{ position: 'relative' }}
        aria-hidden="true"
      >
        <TovisEyeGradient id={gid} />
        <path d={TOVIS_EYE_PATH} fill={`url(#${gid})`} />
      </svg>

      {/* soft radiating orb — fully diffused edges, warm gold into teal/green */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '88%',
          height: '88%',
          background:
            'radial-gradient(circle at center, rgba(255,243,202,0.46) 0%, rgba(249,216,134,0.36) 19%, rgba(122,226,188,0.30) 40%, rgba(92,208,176,0.12) 60%, transparent 80%)',
          mixBlendMode: 'screen',
          transform: 'translate(-95%, -58%)',
          animation: 'tovisOrb 7.2s ease-in-out infinite',
        }}
      />
    </RingCoin>
  )
}
